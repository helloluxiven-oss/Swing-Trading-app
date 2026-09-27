import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseLiquidity, dayLevels, sessionAt, sessionBoxes, headlineLean } from "../lib/liquidity";
import { portfolioHistory } from "../lib/portfolio";
import type { Candle } from "../lib/indicators";

// 2026-09-22 00:00 UTC = 2026-09-21 20:00 New York (EDT): Asia opens.
const T0 = Date.UTC(2026, 8, 22, 0, 0) / 1000;
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ t: T0 + i * 300, o, h, l, c, v: 100 });

/** Asia (84 bars) ranging 1990–2010, then London bars from `london`. */
function day(london: [number, number, number, number][]): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 84; i++) {
    const m = 2000 + Math.sin(i / 4) * 8;
    cs.push(bar(i, m, i === 30 ? 2010 : m + 1, i === 60 ? 1990 : m - 1, m));
  }
  london.forEach(([o, h, l, c], k) => cs.push(bar(84 + k, o, h, l, c)));
  return cs;
}
const NOW = (cs: Candle[]) => cs[cs.length - 1].t + 600; // last bar closed

test("sessions are cut in New York time", () => {
  assert.equal(sessionAt(T0), "Asia");
  assert.equal(sessionAt(T0 + 7 * 3600), "London"); // 03:00 NY
  assert.equal(sessionAt(T0 + 11 * 3600 + 1800), null); // 07:30 NY gap
  assert.equal(sessionAt(T0 + 12 * 3600), "New York"); // 08:00 NY
  const boxes = sessionBoxes(day([[2000, 2001, 1999, 2000]]));
  assert.deepEqual(boxes.map((b) => b.name), ["Asia", "London"]);
  assert.equal(boxes[0].high, 2010);
  assert.equal(boxes[0].low, 1990);
});

test("inside the previous range → waiting", () => {
  const cs = day([[2000, 2004, 1998, 2002], [2002, 2005, 2000, 2001]]);
  const r = analyseLiquidity(cs, { now: NOW(cs) })!;
  assert.equal(r.prev?.name, "Asia");
  assert.equal(r.stage, "waiting");
});

test("sweep above Asia high without reclaim → swept (a breakout, no short)", () => {
  const cs = day([[2005, 2012, 2004, 2011], [2011, 2016, 2010, 2015]]);
  const r = analyseLiquidity(cs, { now: NOW(cs) })!;
  assert.equal(r.stage, "swept");
  assert.equal(r.plan, null);
});

test("sweep, reclaim, structure shift → short plan with stop above the sweep", () => {
  const cs = day([
    [2004, 2006, 2003, 2005],
    [2005, 2008, 2004, 2007], // swing low area 2003–2004
    [2007, 2014, 2006, 2012], // sweep of 2010
    [2012, 2013, 2007, 2008], // close back below 2010 → reclaimed
    [2008, 2009, 2001, 2002], // close below the swing low → MSS
  ]);
  const r = analyseLiquidity(cs, { now: NOW(cs) })!;
  assert.equal(r.sweep?.side, "high");
  assert.equal(r.sweep?.extreme, 2014);
  assert.equal(r.stage, "ready");
  const p = r.plan!;
  assert.equal(p.side, "short");
  assert.ok(p.stop > 2014, "stop sits beyond the sweep extreme");
  assert.ok(p.entry < 2010 && p.entry > 1990);
  assert.equal(p.tp2, 1990, "TP2 is the opposite side of the Asia range");
  assert.ok(Math.abs(p.tp1 - (p.entry - 2 * p.risk)) < 0.02);
});

test("both sides of the range taken → stand aside", () => {
  const cs = day([[2005, 2013, 2004, 2006], [2006, 2007, 1985, 1995]]);
  assert.equal(analyseLiquidity(cs, { now: NOW(cs) })!.stage, "both");
});

test("the forming bar is ignored", () => {
  const cs = day([[2000, 2004, 1998, 2002], [2005, 2012, 2004, 2011]]); // only the forming bar sweeps
  const r = analyseLiquidity(cs, { now: cs[cs.length - 1].t + 60 })!;
  assert.equal(r.stage, "waiting");
});

test("headline lean is keyword-only", () => {
  assert.equal(headlineLean("Gold hits record high as dollar weakens on rate cut bets"), "bullish");
  assert.equal(headlineLean("Gold slides as hawkish Fed lifts yields"), "bearish");
  assert.equal(headlineLean("Gold steady ahead of CPI"), null);
});

test("portfolio history: value, invested and index benchmark", () => {
  const D = 86400;
  const c = (d: number, px: number): Candle => ({ t: d * D, o: px, h: px, l: px, c: px, v: 0 });
  const pts = portfolioHistory([
    { qty: 2, avg: 100, boughtOn: 2 * D, fx: 1, candles: [c(1, 90), c(2, 100), c(3, 110)], bench: [c(1, 50), c(2, 50), c(3, 55)] },
  ]);
  assert.deepEqual(pts.map((p) => p.t / D), [2, 3]);
  assert.equal(pts[1].value, 220);
  assert.equal(pts[1].invested, 200);
  assert.equal(pts[1].bench, 220); // 200 into the index at 50, now 55
});

test("day levels: every session's high and low, with sweeps marked", () => {
  const cs = day([[2004, 2006, 2003, 2005], [2005, 2014, 2004, 2012], [2012, 2013, 2007, 2008]]);
  const lv = dayLevels(cs);
  const asiaHigh = lv.find((l) => l.session === "Asia" && l.kind === "high")!;
  const asiaLow = lv.find((l) => l.session === "Asia" && l.kind === "low")!;
  assert.equal(asiaHigh.price, 2010);
  assert.ok(asiaHigh.sweptI !== null, "London ran the Asia high");
  assert.equal(asiaLow.sweptI, null, "Asia low still resting");
  assert.ok(lv.some((l) => l.session === "London" && l.live));
});
