// "What to do today" for an index or coin's options — one decision from every
// input, with the working shown. Pure, so it is tested.
//
// Each input scores between −2 (bearish) and +2 (bullish):
//   trend      daily close vs 20 / 50 EMA and the 5-day change
//   options    the chain's own read (PCR, walls, max pain, skew)
//   flows      FII / DII net cash (India) · perpetual funding, contrarian (crypto)
//   news       keyword lean of today's headlines
//   expiry     max-pain pull when expiry is within ~2 days
// Dealer gamma scales conviction: short gamma lets trends run, long gamma damps them.
//
//   total ≥ +2.0 → BUY CALL        total ≤ −2.0 → BUY PUT
//   |total| < 1.2 with rich IV and long gamma → SELL PREMIUM (range)
//   anything else → NO TRADE (signals disagree — waiting is a position)
//
// Levels come from the chain: invalidation at the put/call wall or half an
// expected move, targets at half and one expected move / the opposite wall.
// Premiums at those levels are Black-Scholes re-prices with the strike's own IV.

import { bsPrice, greeks, type Analysis, type ChainRow } from "./options";

export type Factor = { name: string; score: number; note: string };
export type Decision = {
  action: "BUY CALL" | "BUY PUT" | "SELL PREMIUM" | "NO TRADE";
  score: number;
  confidence: number; // 0–100
  factors: Factor[];
  headline: string;
  trade: null | {
    leg: string; // e.g. "Buy 25100 CE"
    strike: number;
    type: "call" | "put";
    entry: number; // option premium now
    entryMax: number; // don't chase above
    stop: number; // premium if the underlying hits the invalidation level
    target1: number;
    target2: number;
    invalidation: number; // underlying level
    under1: number; // underlying targets
    under2: number;
    delta: number;
    spread?: string; // cheaper, lower-vega alternative
  };
  cautions: string[];
};

export type DecisionInput = {
  spot: number;
  T: number; // years to the selected expiry
  rows: ChainRow[];
  a: Analysis;
  ivAtm: number | null;
  rv: number | null;
  closes: number[]; // daily closes, oldest first
  flows?: { fiiNet: number; diiNet: number } | null;
  funding8h?: number | null;
  news: { bull: number; bear: number };
  step: number;
};

const clamp = (x: number, lo = -2, hi = 2) => Math.max(lo, Math.min(hi, x));
function ema(v: number[], n: number) {
  if (v.length < n) return null;
  const k = 2 / (n + 1);
  let e = v.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < v.length; i++) e = v[i] * k + e * (1 - k);
  return e;
}

export function decide(x: DecisionInput): Decision {
  const { spot, T, a } = x;
  const f: Factor[] = [];

  // Trend
  const e20 = ema(x.closes, 20), e50 = ema(x.closes, 50);
  const c = x.closes[x.closes.length - 1] ?? spot;
  const c5 = x.closes[x.closes.length - 6];
  let t = 0;
  if (e20 && e50) t = c > e20 && e20 > e50 ? 1.5 : c > e50 ? 0.75 : c < e20 && e20 < e50 ? -1.5 : c < e50 ? -0.75 : 0;
  const r5 = c5 ? ((c - c5) / c5) * 100 : 0;
  t = clamp(t + clamp(r5 / 3, -0.5, 0.5));
  f.push({ name: "Trend", score: t, note: e20 && e50 ? `Close ${c.toFixed(0)} vs 20 EMA ${e20.toFixed(0)} / 50 EMA ${e50.toFixed(0)}; 5-day ${r5 >= 0 ? "+" : ""}${r5.toFixed(1)}%` : "Not enough daily history" });

  // Options positioning
  let o = a.bias === "bullish" ? 1 : a.bias === "bearish" ? -1 : 0;
  if (a.pcr != null) o += a.pcr > 1.2 ? 0.5 : a.pcr < 0.75 ? -0.5 : 0;
  if (a.skew != null && a.skew > 3) o -= 0.5;
  o = clamp(o);
  f.push({ name: "Options", score: o, note: `PCR ${a.pcr?.toFixed(2) ?? "—"}, put wall ${a.putWall ?? "—"} / call wall ${a.callWall ?? "—"}${a.skew != null ? `, skew ${a.skew.toFixed(1)}` : ""}` });

  // Flows
  if (x.flows) {
    const { fiiNet, diiNet } = x.flows;
    let fl = clamp(fiiNet / 2500, -1.5, 1.5);
    if (fiiNet < 0 && diiNet > -fiiNet) fl += 0.5; // DIIs absorbing the selling
    fl = clamp(fl);
    f.push({ name: "FII / DII", score: fl, note: `FII ${fiiNet >= 0 ? "+" : ""}${fiiNet.toFixed(0)} Cr, DII ${diiNet >= 0 ? "+" : ""}${diiNet.toFixed(0)} Cr` });
  } else if (x.funding8h != null) {
    // Crowded longs (high positive funding) are a contrarian warning.
    const fu = x.funding8h > 0.0003 ? -0.75 : x.funding8h < -0.0001 ? 0.75 : 0;
    f.push({ name: "Funding", score: fu, note: `Perpetual funding ${(x.funding8h * 100).toFixed(4)}% / 8h${fu < 0 ? " — longs crowded" : fu > 0 ? " — shorts paying" : ""}` });
  }

  // News
  const tot = x.news.bull + x.news.bear;
  const nw = tot ? clamp(((x.news.bull - x.news.bear) / Math.max(3, tot)) * 1.5, -1, 1) : 0;
  f.push({ name: "News", score: nw, note: tot ? `${x.news.bull} bullish vs ${x.news.bear} bearish headlines (keyword read)` : "No clear lean in headlines" });

  // Expiry pull
  const days = T * 365;
  if (a.maxPain && days < 2.5) {
    const d = (a.maxPain - spot) / spot;
    const ex = Math.abs(d) > 0.003 ? clamp(d * 100, -0.75, 0.75) : 0;
    f.push({ name: "Expiry pull", score: ex, note: `Max pain ${a.maxPain} with ${days.toFixed(1)} days to expiry` });
  }

  // Gamma scales how far a directional view is likely to run.
  const g = a.totalGex < 0 ? 1.15 : 0.9;
  const raw = f.reduce((s, x2) => s + x2.score, 0);
  const score = +(raw * g).toFixed(2);
  const ratio = x.ivAtm && x.rv ? x.ivAtm / x.rv : null;
  const cautions: string[] = [];
  if (ratio && ratio > 1.3) cautions.push(`Options are expensive (IV/RV ${ratio.toFixed(2)}) — prefer the spread over a naked buy.`);
  if (days < 1) cautions.push("Expiry day: premiums decay by the hour. Take profits quickly; never hold a loser into the close.");
  if (a.totalGex > 0 && Math.abs(score) >= 2) cautions.push("Dealers are long gamma — breakouts tend to stall at the walls. Book part at target 1.");
  const signs = f.filter((y) => Math.abs(y.score) >= 0.5).map((y) => Math.sign(y.score));
  const agree = signs.length ? Math.abs(signs.reduce((s, y) => s + y, 0)) / signs.length : 0;

  let action: Decision["action"];
  if (score >= 2 && agree >= 0.5) action = "BUY CALL";
  else if (score <= -2 && agree >= 0.5) action = "BUY PUT";
  else if (Math.abs(score) < 1.2 && ratio != null && ratio > 1.1 && a.totalGex >= 0) action = "SELL PREMIUM";
  else action = "NO TRADE";
  const confidence = Math.round(Math.min(95, (Math.abs(score) / 5) * 100 * (0.6 + 0.4 * agree)));

  let trade: Decision["trade"] = null;
  const em = a.expectedMove ?? spot * (x.ivAtm ?? 0.15) * Math.sqrt(T);
  if (action === "BUY CALL" || action === "BUY PUT") {
    const type = action === "BUY CALL" ? "call" : "put";
    const dir = type === "call" ? 1 : -1;
    // One strike in the money for delta ~0.55–0.6: less decay than out-of-the-money lottery tickets.
    const sorted = [...x.rows].filter((r) => (type === "call" ? r.callPrice : r.putPrice)).sort((p, q) => p.strike - q.strike);
    const atmI = sorted.findIndex((r) => r.strike >= spot);
    const pickI = Math.max(0, Math.min(sorted.length - 1, type === "call" ? atmI - 1 : atmI));
    const r = sorted[pickI];
    if (r) {
      const sig = (type === "call" ? r.callIV : r.putIV) ?? x.ivAtm ?? 0.15;
      const px = (type === "call" ? r.callPrice : r.putPrice) ?? bsPrice(type, spot, r.strike, T, sig);
      const wall = type === "call" ? a.putWall : a.callWall; // the level that must hold
      const half = spot - dir * em * 0.5;
      const inv = wall != null && Math.abs(wall - spot) < em ? (dir > 0 ? Math.max(wall, half) : Math.min(wall, half)) : half;
      const oppWall = type === "call" ? a.callWall : a.putWall;
      const u1 = spot + dir * em * 0.5;
      const u2 = oppWall != null && dir * (oppWall - spot) > em * 0.5 ? oppWall : spot + dir * em;
      const later = Math.max(T - 1 / 365, 1 / (365 * 24));
      const at = (S: number) => Math.max(0.05, bsPrice(type, S, r.strike, later, sig));
      const next = sorted[type === "call" ? pickI + Math.max(1, Math.round((em * 0.8) / x.step)) : pickI - Math.max(1, Math.round((em * 0.8) / x.step))];
      trade = {
        leg: `Buy ${r.strike} ${type === "call" ? "CE" : "PE"}`,
        strike: r.strike,
        type,
        entry: px,
        entryMax: px * 1.05,
        stop: at(inv),
        target1: at(u1),
        target2: at(u2),
        invalidation: inv,
        under1: u1,
        under2: u2,
        delta: greeks(type, spot, r.strike, T, sig).delta,
        spread: next ? `Cheaper: buy ${r.strike} ${type === "call" ? "CE" : "PE"}, sell ${next.strike} ${type === "call" ? "CE" : "PE"} (${type === "call" ? "bull call" : "bear put"} spread) — half the vega and theta` : undefined,
      };
    }
  }

  const headline =
    action === "BUY CALL" ? "Bullish — calls favoured today"
    : action === "BUY PUT" ? "Bearish — puts favoured today"
    : action === "SELL PREMIUM" ? "Range day — sell premium (iron condor / strangle), don't buy options"
    : "Mixed signals — no directional trade; wait for them to line up";
  return { action, score, confidence, factors: f, headline, trade, cautions };
}

/** Count bullish / bearish headlines with the same keyword read the news cards use. */
export function newsLean(titles: string[], lean: (t: string) => "bullish" | "bearish" | null) {
  let bull = 0, bear = 0;
  for (const t of titles) {
    const l = lean(t);
    if (l === "bullish") bull++;
    else if (l === "bearish") bear++;
  }
  return { bull, bear };
}
