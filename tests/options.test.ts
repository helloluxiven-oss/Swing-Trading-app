import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseChain, bsPrice, greeks, maxPain, pcr, type ChainRow } from "../lib/options";

const close = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("Black-Scholes matches the textbook example (Hull: S=42 K=40 r=10% σ=20% T=0.5)", () => {
  close(bsPrice("call", 42, 40, 0.5, 0.2, 0.1), 4.76, 0.01);
  close(bsPrice("put", 42, 40, 0.5, 0.2, 0.1), 0.81, 0.01);
  const g = greeks("call", 42, 40, 0.5, 0.2, 0.1);
  close(g.delta, 0.7791, 0.001);
  close(greeks("put", 42, 40, 0.5, 0.2, 0.1).delta, 0.7791 - 1, 0.001);
  assert.ok(g.gamma > 0 && g.vega > 0 && g.theta < 0);
});

const chain: ChainRow[] = [
  { strike: 95, callOI: 100, putOI: 900, callIV: 0.22, putIV: 0.26, callPrice: 6, putPrice: 1 },
  { strike: 100, callOI: 500, putOI: 600, callIV: 0.2, putIV: 0.21, callPrice: 2.4, putPrice: 2.4 },
  { strike: 105, callOI: 1000, putOI: 100, callIV: 0.19, putIV: 0.2, callPrice: 0.8, putPrice: 5.8 },
];

test("max pain and put/call ratio", () => {
  // payout at 95: calls 0; puts 600*5 + 100*10 = 4000 · at 100: calls 100*5=500; puts 100*5=500 → 1000 · at 105: calls 100*10+500*5=3500
  assert.equal(maxPain(chain), 100);
  close(pcr(chain)!, 1600 / 1600, 1e-9);
});

test("analysis reads the walls, expected move and skew", () => {
  const a = analyseChain(chain, 100, 7 / 365);
  assert.equal(a.atm, 100);
  assert.equal(a.callWall, 105);
  assert.equal(a.putWall, 95);
  assert.equal(a.maxPain, 100);
  close(a.expectedMove!, 4.8, 1e-9); // ATM straddle
  close(a.skew!, (0.26 - 0.19) * 100, 1e-9); // put ~95 vs call ~105
  assert.ok(a.reads.some((r) => r.text.includes("Put skew")));
});

import { buildStrategies, payoff, realisedVol } from "../lib/strategies";
import { analyseChain as ac } from "../lib/options";

test("payoff and strategy maths (iron condor is defined risk, straddle is not)", () => {
  // A symmetric chain around 100 priced with Black-Scholes at 20% IV, 30 days.
  const { bsPrice: bp } = require("../lib/options") as typeof import("../lib/options");
  const T = 30 / 365, S = 100;
  const rows = Array.from({ length: 21 }, (_, i) => 80 + i * 2).map((k) => ({
    strike: k, callOI: 1000 + (k > 100 ? (k - 100) * 50 : 0), putOI: 1000 + (k < 100 ? (100 - k) * 50 : 0),
    callIV: 0.2, putIV: 0.2, callPrice: bp("call", S, k, T, 0.2), putPrice: bp("put", S, k, T, 0.2),
  }));
  const a = ac(rows, S, T);
  const list = buildStrategies(rows, { spot: S, T, ivAtm: 0.2, rv: 0.12, a, step: 2 });
  const ic = list.find((s) => s.id === "iron-condor")!;
  assert.ok(ic.net > 0, "condor collects a credit");
  assert.ok(ic.maxLoss != null && ic.maxLoss > 0, "condor has a defined max loss");
  assert.equal(ic.breakevens.length, 2);
  const ss = list.find((s) => s.id === "short-straddle")!;
  assert.equal(ss.maxLoss, null, "short straddle risk is unlimited");
  close(Math.abs(ss.greeks.delta), 0, 0.1); // delta-neutral at the money
  assert.ok(ss.greeks.theta > 0 && ss.greeks.vega < 0, "short premium: earns theta, short vega");
  // Options rich (IV 20% vs RV 12%) and a neutral chain → premium selling ranks first.
  assert.equal(list[0].family, "delta-neutral");
  assert.ok(ss.pop > 0.3 && ss.pop < 0.8);
  close(payoff([{ side: "buy", type: "call", strike: 100, price: 2, qty: 1 }], 110), 8, 1e-9);
});

test("realised vol of a steady 1%-a-day zigzag", () => {
  const c = [100]; for (let i = 0; i < 40; i++) c.push(c[c.length - 1] * (i % 2 ? 1.01 : 0.99));
  close(realisedVol(c)!, 0.01 * Math.sqrt(252), 0.02);
});

import { decide } from "../lib/decision";

test("decision: aligned bullish inputs → BUY CALL with levels; mixed → NO TRADE", () => {
  const { bsPrice: bp } = require("../lib/options") as typeof import("../lib/options");
  const T = 3 / 365, S = 100;
  const rows = Array.from({ length: 21 }, (_, i) => 90 + i).map((k) => ({
    strike: k, callOI: k > 103 ? 3000 : 800, putOI: k < 98 ? 5000 : 900, callIV: 0.18, putIV: 0.19,
    callPrice: bp("call", S, k, T, 0.18), putPrice: bp("put", S, k, T, 0.19),
  }));
  const a = ac(rows, S, T);
  const up = Array.from({ length: 60 }, (_, i) => 80 + i * 0.35); // steady uptrend ending ~100.7
  const bull = decide({ spot: S, T, rows, a: { ...a, bias: "bullish" }, ivAtm: 0.18, rv: 0.16, closes: up, flows: { fiiNet: 3000, diiNet: 500 }, news: { bull: 5, bear: 1 }, step: 1 });
  assert.equal(bull.action, "BUY CALL");
  const tr = bull.trade!;
  assert.ok(tr.strike <= S, "one strike in the money");
  assert.ok(tr.stop < tr.entry && tr.entry < tr.target1 && tr.target1 <= tr.target2, "stop < entry < targets");
  assert.ok(tr.invalidation < S && tr.under1 > S);
  const mixed = decide({ spot: S, T, rows, a: { ...a, bias: "neutral", totalGex: -1 }, ivAtm: 0.18, rv: 0.2, closes: up, flows: { fiiNet: -3000, diiNet: 0 }, news: { bull: 0, bear: 4 }, step: 1 });
  assert.equal(mixed.action, "NO TRADE");
  assert.equal(mixed.trade, null);
});

test("decision: premium stop never risks more than 40%", () => {
  const { bsPrice: bp } = require("../lib/options") as typeof import("../lib/options");
  const T = 1.5 / 365, S = 100;
  const rows = Array.from({ length: 21 }, (_, i) => 90 + i).map((k) => ({ strike: k, callOI: 1000, putOI: k < 97 ? 4000 : 800, callIV: 0.14, putIV: 0.15, callPrice: bp("call", S, k, T, 0.14), putPrice: bp("put", S, k, T, 0.15) }));
  const a = ac(rows, S, T);
  const down = Array.from({ length: 60 }, (_, i) => 120 - i * 0.33);
  const d = decide({ spot: S, T, rows, a: { ...a, bias: "bearish" }, ivAtm: 0.15, rv: 0.14, closes: down, flows: { fiiNet: -4000, diiNet: 1000 }, news: { bull: 0, bear: 3 }, step: 1 });
  assert.equal(d.action, "BUY PUT");
  assert.ok(d.trade!.stop >= d.trade!.entry * 0.6 - 1e-9);
  assert.ok(/sell \d+ PE/.test(d.trade!.spread!) && !d.trade!.spread!.includes(`sell ${d.trade!.strike - 1} PE`), "spread strike is further out than one step");
});
