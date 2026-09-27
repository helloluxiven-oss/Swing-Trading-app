import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRules, rank, exitWatch, WEIGHTS } from "../lib/score";
import type { Analysis, Rule, Status } from "../lib/setup";

const rules = (pass: string[]): Rule[] =>
  Object.keys(WEIGHTS).map((id) => ({ id, label: id, pass: pass.includes(id), detail: "" }));

test("weights add up to 100 and the five required rules to 80", () => {
  assert.equal(scoreRules(rules(Object.keys(WEIGHTS))), 100);
  assert.equal(scoreRules(rules(["trend", "pullback", "rsi", "candle", "market"])), 80);
  assert.equal(scoreRules(rules([])), 0);
});

function fake(status: Status, pass: string[], ret63 = 0, idx: number | null = 0): Analysis {
  const r = rules(pass);
  const side = { side: "long" as const, status, rules: r };
  return {
    last: { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1 }, prevClose: 100, ema20: 100, ema50: 95, rsi: 50, rsiPrev: 48,
    volAvg20: 1, high52: 120, low52: 80, rangePos: 0.5, atr14: 2, ret63, indexRet63: idx, indexAbove50: true,
    swingLow: 96, swingHigh: 104, patterns: [], long: side, short: { ...side, side: "short" }, best: side,
  };
}

test("tradeable stocks rank first even with a lower score, then score, then relative strength", () => {
  const rows = [
    { id: "near", analysis: fake("watch", ["trend", "pullback", "rsi", "volume", "strength"]) }, // 80, not tradeable
    { id: "ready", analysis: fake("ready", ["trend", "pullback", "rsi", "candle", "market"]) }, // 80, tradeable
    { id: "weakRS", analysis: fake("watch", ["trend", "pullback"], 1, 5) },
    { id: "strongRS", analysis: fake("watch", ["trend", "pullback"], 9, 5) },
    { id: "nodata", analysis: null },
  ];
  const r = rank(rows, 10).map((x) => x.id);
  assert.deepEqual(r, ["ready", "near", "strongRS", "weakRS"]);
});

test("rank respects the limit", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ analysis: fake("none", [], i, 0) }));
  assert.equal(rank(rows, 10).length, 10);
});

test("exit watch: RSI 70 means take profit, below the 50 EMA means broken", () => {
  const a = fake("none", []);
  assert.equal(exitWatch({ ...a, rsi: 72 })[0].level, "take-profit");
  assert.equal(exitWatch({ ...a, last: { ...a.last, c: 90 } }).some((s) => s.level === "broken"), true);
  assert.equal(exitWatch({ ...a, last: { ...a.last, c: 97 }, ema20: 100, ema50: 95 })[0].level, "caution");
  assert.equal(exitWatch(a)[0].level, "ok");
});

import { focus52 } from "../lib/focus52";

test("52-week focus reproduces the sheet's formula and flags disagreement with the trend", () => {
  // range 100–200: bottom 20% is ≤ 120, top 20% is ≥ 180
  assert.equal(focus52(120, 100, 200, 130).focus, "BUY FOCUS");
  assert.equal(focus52(121, 100, 200, 130).focus, "NEUTRAL");
  assert.equal(focus52(180, 100, 200, 150).focus, "SELL FOCUS");
  assert.equal(focus52(110, 100, 200, 130).trendAgrees, false); // below 50 EMA: falling knife
  assert.equal(focus52(115, 100, 200, 110).trendAgrees, true); // back above the 50 EMA
  assert.equal(focus52(190, 100, 200, 150).trendAgrees, false); // strong stock, short fights trend
});
