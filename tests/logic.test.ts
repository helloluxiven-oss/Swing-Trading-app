import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, rsi, sma, patternsAt, type Candle } from "../lib/indicators";
import { analyse } from "../lib/setup";
import { plan, resultR } from "../lib/plan";
import { runGate, inOfficeHours, lossStreak, type Settings } from "../lib/gate";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// ---- indicators: hand-worked values -----------------------------------------

test("sma of 1..5 over 3", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("ema seeds with the SMA, then smooths with k = 2/(n+1)", () => {
  const e = ema([1, 2, 3, 4], 3); // seed (1+2+3)/3 = 2, then 4*0.5 + 2*0.5 = 3
  assert.deepEqual(e, [null, null, 2, 3]);
});

test("rsi is 100 on a series that only rises, 0 on one that only falls", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  const down = Array.from({ length: 20 }, (_, i) => 100 - i);
  assert.equal(rsi(up)[19], 100);
  close(rsi(down)[19]!, 0);
});

test("rsi of alternating equal moves sits at 50", () => {
  const alt = Array.from({ length: 30 }, (_, i) => (i % 2 ? 101 : 100));
  const v = rsi(alt)[29]!;
  assert.ok(v > 45 && v < 55, String(v));
});

// ---- patterns ---------------------------------------------------------------

const C = (o: number, h: number, l: number, c: number, v = 1000): Candle => ({ t: 0, o, h, l, c, v });

test("bullish engulfing is detected", () => {
  const cs = [C(10, 10.2, 9.4, 9.5), C(9.4, 10.5, 9.3, 10.4)];
  assert.ok(patternsAt(cs, 1).some((p) => p.name === "Bullish Engulfing"));
});

test("hammer is detected", () => {
  const cs = [C(10, 10.1, 8, 10.05)]; // tiny body at the top, long lower wick
  assert.ok(patternsAt(cs, 0).some((p) => p.name === "Hammer" || p.name === "Dragonfly Doji"));
});

// ---- the setup, on a constructed series --------------------------------------

/** 80 days of steady uptrend, then a 4-day dip to the 20 EMA and a green bounce. */
function uptrendPullback(): Candle[] {
  const cs: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 80; i++) {
    const o = p;
    p = p * 1.004;
    cs.push({ t: i, o, h: p * 1.003, l: o * 0.997, c: p, v: 1000 });
  }
  for (let i = 0; i < 4; i++) {
    const o = p;
    p = p * 0.988;
    cs.push({ t: 80 + i, o, h: o * 1.001, l: p * 0.998, c: p, v: 900 });
  }
  const o = p;
  p = p * 1.006;
  cs.push({ t: 84, o, h: p * 1.002, l: o * 0.998, c: p, v: 1600 });
  return cs;
}

test("an uptrend pulling back to the 20 EMA reads as a long setup", () => {
  const a = analyse(uptrendPullback(), { above50: true, ret63: 1 })!;
  const byId = Object.fromEntries(a.long.rules.map((r) => [r.id, r.pass]));
  assert.equal(byId.trend, true, "above 50 EMA");
  assert.equal(byId.pullback, true, "touched the 20 EMA");
  assert.equal(byId.candle, true, "green candle near the 20 EMA");
  assert.equal(byId.volume, true, "volume spike");
  assert.equal(byId.market, true, "index above its 50 EMA");
  assert.equal(byId.strength, true, "beat the index");
  assert.equal(a.short.rules.find((r) => r.id === "trend")!.pass, false);
});

test("v2: the same stock in a falling market is not a long setup", () => {
  const a = analyse(uptrendPullback(), { above50: false, ret63: -5 })!;
  assert.equal(a.long.rules.find((r) => r.id === "market")!.pass, false);
  assert.ok(a.long.status === "watch" || a.long.status === "none");
});

test("v2: missing index data never passes silently", () => {
  const a = analyse(uptrendPullback(), null)!;
  assert.equal(a.long.rules.find((r) => r.id === "market")!.pass, false);
  assert.match(a.long.rules.find((r) => r.id === "market")!.detail, /unavailable/);
});

test("too little history returns null rather than a guess", () => {
  assert.equal(analyse(uptrendPullback().slice(0, 60)), null);
});

// ---- plan -------------------------------------------------------------------

test("long plan: entry above high, stop below swing low, target at 1:2, sized by risk", () => {
  const p = plan({
    side: "long", market: "IN", signalHigh: 100, signalLow: 97, swingLow: 95, swingHigh: 105,
    capital: 100000, riskPct: 1, stopMode: "swing", fixedStopPct: 2, atr: 3, atrMult: 1, rr: 2,
  });
  assert.equal(p.entry, 100.05);
  assert.equal(p.stop, 94.95);
  close(p.riskPerShare, 5.1, 1e-9);
  assert.equal(p.target, 110.25);
  assert.equal(p.qty, 196); // floor(1000 / 5.10)
  assert.ok(p.maxLoss <= 1000);
});

test("plan is capped by capital when the stop is very tight", () => {
  const p = plan({
    side: "long", market: "US", signalHigh: 500, signalLow: 499, swingLow: 499, swingHigh: 510,
    capital: 1000, riskPct: 2, stopMode: "swing", fixedStopPct: 2, atr: 5, atrMult: 1, rr: 2,
  });
  assert.ok(p.capitalUsed <= 1000);
  assert.equal(p.cappedByCapital, true);
});

test("short plan mirrors the long one", () => {
  const p = plan({
    side: "short", market: "US", signalHigh: 50, signalLow: 48, swingLow: 45, swingHigh: 51,
    capital: 10000, riskPct: 1, stopMode: "fixed", fixedStopPct: 2, atr: 1, atrMult: 1, rr: 2,
  });
  assert.equal(p.entry, 47.99);
  assert.ok(p.stop > p.entry && p.target < p.entry);
});

test("smart stop widens a too-tight swing stop to at least 1 ATR", () => {
  const p = plan({
    side: "long", market: "US", signalHigh: 100, signalLow: 99, swingLow: 99.5, swingHigh: 105,
    capital: 100000, riskPct: 1, stopMode: "smart", fixedStopPct: 2, atr: 2, atrMult: 1, rr: 2,
  });
  // swing stop would be 99.49 (0.52 away); 1 ATR from entry 100.01 is 98.01
  assert.equal(p.stop, 98.01);
  assert.equal(p.breakevenAt, 102.01);
});

test("result in R", () => {
  assert.equal(resultR("long", 100, 95, 110), 2);
  assert.equal(resultR("long", 100, 95, 95), -1);
  assert.equal(resultR("short", 100, 105, 90), 2);
});

// ---- gate -------------------------------------------------------------------

const S: Settings = {
  timezone: "Asia/Kolkata",
  officeStart: "09:30",
  officeEnd: "18:00",
  officeDays: [1, 2, 3, 4, 5],
  maxConsecutiveLosses: 2,
};
// 2026-09-28 is a Monday. 12:00 IST = 06:30 UTC; 19:00 IST = 13:30 UTC.
const monNoonIST = new Date("2026-09-28T06:30:00Z");
const monEveningIST = new Date("2026-09-28T13:30:00Z");
const sunNoonIST = new Date("2026-09-27T06:30:00Z");
const calm = { fomo: false, revenge: false, fear: false, greed: false };

test("office hours respect the time zone and the working days", () => {
  assert.equal(inOfficeHours(monNoonIST, S), true);
  assert.equal(inOfficeHours(monEveningIST, S), false);
  assert.equal(inOfficeHours(sunNoonIST, S), false);
});

test("gate allows a clean trade in the evening", () => {
  const g = runGate({
    now: monEveningIST, settings: S, setupStatus: "ready", withTrend: true,
    emotions: calm, recentClosed: [], hasStopAndTarget: true,
  });
  assert.equal(g.allowed, true);
});

test("gate blocks during office hours, on FOMO, and on a non-setup", () => {
  const base = { settings: S, withTrend: true, recentClosed: [], hasStopAndTarget: true };
  assert.equal(runGate({ ...base, now: monNoonIST, setupStatus: "ready", emotions: calm }).allowed, false);
  assert.equal(runGate({ ...base, now: monEveningIST, setupStatus: "ready", emotions: { ...calm, fomo: true } }).allowed, false);
  assert.equal(runGate({ ...base, now: monEveningIST, setupStatus: "watch", emotions: calm }).allowed, false);
});

test("two losses in a row today trigger the cool-down; a win breaks the streak", () => {
  const recent = [
    { closedAt: "2026-09-28T12:00:00Z", resultR: -1 },
    { closedAt: "2026-09-28T10:00:00Z", resultR: -0.5 },
    { closedAt: "2026-09-25T10:00:00Z", resultR: 2 },
  ];
  assert.deepEqual(lossStreak(recent, monEveningIST, S.timezone), { streak: 2, lastLossToday: true });
  const g = runGate({
    now: monEveningIST, settings: S, setupStatus: "ready", withTrend: true,
    emotions: calm, recentClosed: recent, hasStopAndTarget: true,
  });
  assert.equal(g.allowed, false);
  assert.equal(g.checks.find((c) => c.id === "cooldown")!.pass, false);
  // the next day the same streak no longer blocks
  const tue = new Date("2026-09-29T13:30:00Z");
  assert.equal(lossStreak(recent, tue, S.timezone).lastLossToday, false);
});
