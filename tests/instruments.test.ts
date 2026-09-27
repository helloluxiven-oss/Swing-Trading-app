import { test } from "node:test";
import assert from "node:assert/strict";
import { findInstrument, sizeFor, deskInstruments, fmtPrice } from "../lib/instruments";
import { analyseLiquidity } from "../lib/liquidity";
import type { Candle } from "../lib/indicators";

test("desks pin XAU and BTC first", () => {
  assert.equal(findInstrument("fx").id, "XAUUSD");
  assert.equal(findInstrument("crypto").id, "BTC");
  assert.equal(findInstrument("fx", "eurusd").id, "EURUSD");
  assert.equal(findInstrument("crypto", "nope").id, "BTC");
  assert.ok(deskInstruments("fx").every((i) => i.kind === "fx"));
});

test("position size per market", () => {
  // Gold: $100 risk, $5 stop, 100 oz a lot → 0.2 lots
  assert.equal(sizeFor(findInstrument("fx", "XAUUSD"), 100, 5, 4300)!.label, "0.20 lots");
  // EURUSD: $100 risk, 20 pip stop (0.0020), 100k a lot → 0.5 lots
  assert.equal(sizeFor(findInstrument("fx", "EURUSD"), 100, 0.002, 1.08)!.label, "0.50 lots");
  // USDJPY: 20 pips (0.20 JPY) at 150 → 0.2/150 USD per unit → 75,000 units → 0.75 lots
  assert.equal(sizeFor(findInstrument("fx", "USDJPY"), 100, 0.2, 150)!.label, "0.75 lots");
  // BTC: $100 risk, $500 stop → 0.2 BTC
  assert.equal(sizeFor(findInstrument("crypto", "BTC"), 100, 500, 60000)!.label, "0.2000 BTC");
  assert.equal(sizeFor(findInstrument("crypto", "BTC"), 100, 0, 60000), null);
});

test("FX plans keep 5 decimals", () => {
  const T0 = Date.UTC(2026, 8, 22, 0, 0) / 1000;
  const k = 1 / 1850; // map the gold-like test prices onto EURUSD
  const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ t: T0 + i * 300, o: o * k, h: h * k, l: l * k, c: c * k, v: 100 });
  const cs: Candle[] = [];
  for (let i = 0; i < 84; i++) {
    const m = 2000 + Math.sin(i / 4) * 8;
    cs.push(bar(i, m, i === 30 ? 2010 : m + 1, i === 60 ? 1990 : m - 1, m));
  }
  [[2004, 2006, 2003, 2005], [2005, 2008, 2004, 2007], [2007, 2014, 2006, 2012], [2012, 2013, 2007, 2008], [2008, 2009, 2001, 2002]].forEach(([o, h, l, c], j) => cs.push(bar(84 + j, o, h, l, c)));
  const r = analyseLiquidity(cs, { now: cs[cs.length - 1].t + 600, precision: 5 })!;
  assert.equal(r.stage, "ready");
  const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;
  assert.ok(decimals(r.plan!.stop) > 2, `stop ${r.plan!.stop} keeps pip precision`);
  assert.ok(r.plan!.stop > r.plan!.entry);
  assert.equal(fmtPrice(findInstrument("fx", "EURUSD"), 1.085431), "1.08543");
});

test("strategy runs on XAU and forex pairs only", async () => {
  const { hasStrategy, INSTRUMENTS } = await import("../lib/instruments");
  const on = INSTRUMENTS.filter(hasStrategy).map((i) => i.id);
  assert.deepEqual(on, ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"]);
  assert.ok(!INSTRUMENTS.some((i) => i.kind === "crypto" && hasStrategy(i)));
});
