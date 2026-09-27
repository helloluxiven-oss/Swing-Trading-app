// Option strategy engine: builds real strategies from the live chain, prices
// them, and ranks them by how well they fit today's market.
//
// The main question for any options trade is "are options expensive or cheap?".
// We answer it with IV / RV: implied vol (what options charge) divided by
// realised vol (how much the underlying has actually been moving).
//   IV/RV > 1.15 → options rich  → favour SELLING premium (straddle, strangle, condor, credit spreads)
//   IV/RV < 0.90 → options cheap → favour BUYING premium  (long straddle/strangle, debit spreads)
// Direction (the chain's bias) picks bullish vs bearish spreads; dealer gamma
// (negative = moves extend) argues against short-premium, delta-neutral trades.
//
// Every figure is computed at expiry from the actual strikes and prices in the
// chain. Nothing here places an order.

import { N, greeks, type Analysis, type ChainRow } from "./options";

export type Leg = { side: "buy" | "sell"; type: "call" | "put"; strike: number; price: number; qty: number };
export type Strategy = {
  id: string;
  name: string;
  family: "delta-neutral" | "directional" | "volatility";
  view: string;
  legs: Leg[];
  net: number; // + credit received, − debit paid (per 1 unit of underlying)
  maxProfit: number | null; // null = unlimited
  maxLoss: number | null; // null = unlimited (positive number = loss size)
  breakevens: number[];
  pop: number; // probability of profit at expiry (lognormal, ATM IV)
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  fit: number; // 0–100
  why: string[];
  manage: string;
};

const nearest = (rows: ChainRow[], k: number) => rows.reduce((b, r) => (Math.abs(r.strike - k) < Math.abs(b.strike - k) ? r : b), rows[0]);
const price = (r: ChainRow, t: "call" | "put") => (t === "call" ? r.callPrice : r.putPrice) ?? null;
const iv = (r: ChainRow, t: "call" | "put") => (t === "call" ? r.callIV : r.putIV) ?? null;

export function payoff(legs: Leg[], S: number) {
  return legs.reduce((s, l) => {
    const intrinsic = l.type === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
    return s + (l.side === "buy" ? intrinsic - l.price : l.price - intrinsic) * l.qty;
  }, 0);
}

/** Probability that the price at expiry is inside [lo, hi] (lognormal, zero drift). */
function probBetween(S: number, sigma: number, T: number, lo: number, hi: number) {
  const z = (K: number) => (Math.log(K / S) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  const cdf = (K: number) => (K <= 0 ? 0 : K === Infinity ? 1 : N(z(K)));
  return Math.max(0, cdf(hi) - cdf(lo));
}

function evaluate(id: string, name: string, family: Strategy["family"], view: string, legs: Leg[], S: number, T: number, sigma: number, manage: string): Omit<Strategy, "fit" | "why"> | null {
  if (legs.some((l) => !(l.price > 0))) return null;
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const lo = Math.max(0.01, strikes[0] * 0.5), hi = strikes[strikes.length - 1] * 1.5;
  // Sample the payoff finely; kinks are at strikes, so include them exactly.
  const xs = [...new Set([...Array.from({ length: 800 }, (_, i) => lo + ((hi - lo) * i) / 799), ...strikes])].sort((a, b) => a - b);
  const ys = xs.map((x) => payoff(legs, x));
  const slopeHi = legs.reduce((s, l) => s + (l.type === "call" ? (l.side === "buy" ? 1 : -1) * l.qty : 0), 0);
  const slopeLo = legs.reduce((s, l) => s + (l.type === "put" ? (l.side === "buy" ? -1 : 1) * l.qty : 0), 0);
  const maxProfit = slopeHi > 0 ? null : Math.max(...ys);
  const worst = Math.min(...ys);
  const maxLoss = slopeHi < 0 || (slopeLo > 0 && false) ? null : slopeLo > 0 ? null : -worst;
  const be: number[] = [];
  for (let i = 1; i < xs.length; i++) if (Math.sign(ys[i - 1]) !== Math.sign(ys[i]) && ys[i - 1] !== 0) be.push(xs[i - 1] + ((xs[i] - xs[i - 1]) * -ys[i - 1]) / (ys[i] - ys[i - 1]));
  // Probability of profit: sum the price ranges where the payoff is positive.
  let pop = 0, start: number | null = ys[0] > 0 ? 0 : null;
  const edges = [0, ...be, Infinity];
  for (let i = 0; i < edges.length - 1; i++) {
    const mid = edges[i] === 0 ? be[0] ? be[0] * 0.9 : S : edges[i + 1] === Infinity ? edges[i] * 1.1 : (edges[i] + edges[i + 1]) / 2;
    if (payoff(legs, mid) > 0) pop += probBetween(S, sigma, T, edges[i], edges[i + 1]);
  }
  void start;
  const g = legs.reduce(
    (acc, l) => {
      const v = l.type === "call" ? l : l;
      const gk = greeks(l.type, S, l.strike, T, sigma);
      const m = (l.side === "buy" ? 1 : -1) * l.qty;
      void v;
      return { delta: acc.delta + gk.delta * m, gamma: acc.gamma + gk.gamma * m, theta: acc.theta + gk.theta * m, vega: acc.vega + gk.vega * m };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );
  const net = legs.reduce((s, l) => s + (l.side === "sell" ? l.price : -l.price) * l.qty, 0);
  return { id, name, family, view, legs, net, maxProfit, maxLoss, breakevens: be, pop, greeks: g, manage };
}

export type Market = { spot: number; T: number; ivAtm: number; rv: number | null; a: Analysis; step: number };

/** Build, price and rank the standard strategies for one expiry. */
export function buildStrategies(rowsIn: ChainRow[], m: Market): Strategy[] {
  const rows = rowsIn.filter((r) => r.callPrice && r.putPrice).sort((a, b) => a.strike - b.strike);
  if (rows.length < 6) return [];
  const { spot: S, T, ivAtm } = m;
  const sigma = ivAtm;
  const em = m.a.expectedMove ?? S * sigma * Math.sqrt(T);
  const atm = nearest(rows, S);
  const up1 = nearest(rows, S + em), dn1 = nearest(rows, S - em);
  const up2 = nearest(rows, S + 1.8 * em), dn2 = nearest(rows, S - 1.8 * em);
  // Short strikes on the OI walls when they sit between spot and ~2 expected moves; wings further out.
  // At the edge of the listed strikes there is no room for a wing, so fall back to ±1 expected move.
  const beyond = (short: ChainRow, dir: 1 | -1, dist: number) => {
    const c = rows.filter((r) => (dir > 0 ? r.strike > short.strike : r.strike < short.strike));
    return c.length ? nearest(c, short.strike + dir * dist) : null;
  };
  const inRange = (k: number | null, dir: 1 | -1) => k != null && (dir > 0 ? k > S && k <= S + 2.2 * em : k < S && k >= S - 2.2 * em);
  let cw = inRange(m.a.callWall, 1) ? nearest(rows, m.a.callWall!) : up1;
  let pw = inRange(m.a.putWall, -1) ? nearest(rows, m.a.putWall!) : dn1;
  let cwWing = beyond(cw, 1, em * 0.8);
  let pwWing = beyond(pw, -1, em * 0.8);
  if (!cwWing) { cw = up1; cwWing = beyond(up1, 1, em * 0.8) ?? up2; }
  if (!pwWing) { pw = dn1; pwWing = beyond(dn1, -1, em * 0.8) ?? dn2; }
  const L = (side: Leg["side"], type: Leg["type"], r: ChainRow): Leg => ({ side, type, strike: r.strike, price: price(r, type) ?? 0, qty: 1 });

  const ratio = m.rv ? ivAtm / m.rv : null;
  const rich = ratio != null ? ratio > 1.15 : false;
  const cheap = ratio != null ? ratio < 0.9 : false;
  const bias = m.a.bias;
  const shortGamma = m.a.totalGex < 0;

  const list: [Omit<Strategy, "fit" | "why"> | null, number, string[]][] = [];
  const add = (s: Omit<Strategy, "fit" | "why"> | null, fit: number, why: string[]) => list.push([s, fit, why]);
  const volWhy = ratio != null ? `IV ${(ivAtm * 100).toFixed(1)}% vs realised ${(m.rv! * 100).toFixed(1)}% (IV/RV ${ratio.toFixed(2)}) — options are ${rich ? "rich" : cheap ? "cheap" : "fairly priced"}` : `ATM IV ${(ivAtm * 100).toFixed(1)}%`;

  // ---- delta-neutral, short premium ----
  add(evaluate("short-straddle", "Short straddle (delta-neutral)", "delta-neutral", "Price stays near the strike; volatility falls",
    [L("sell", "call", atm), L("sell", "put", atm)], S, T, sigma,
    "Hedge delta with futures whenever it passes ±0.20 per straddle; exit at 50% of the credit or if price closes outside a breakeven. Unlimited risk — size small."),
    (rich ? 40 : 10) + (bias === "neutral" ? 25 : 0) + (!shortGamma ? 20 : -25) + (m.a.maxPain && Math.abs(m.a.maxPain - S) / S < 0.005 ? 10 : 0),
    [volWhy, bias === "neutral" ? "Chain reads neutral" : `Chain leans ${bias} — a straddle has no view`, shortGamma ? "Dealers short gamma: moves can run — dangerous for short premium" : "Dealers long gamma: ranges and pinning favour it"]);
  add(evaluate("short-strangle", "Short strangle (delta-neutral)", "delta-neutral", "Price stays inside the expected move",
    [L("sell", "call", up1), L("sell", "put", dn1)], S, T, sigma,
    "Short strikes at ±1 expected move. Keep delta near zero with futures; take profit at 50%, cut if a short strike is touched. Unlimited risk."),
    (rich ? 40 : 10) + (bias === "neutral" ? 20 : 5) + (!shortGamma ? 20 : -20),
    [volWhy, "Wider than a straddle: higher win rate, smaller credit"]);
  add(evaluate("iron-condor", "Iron condor at the OI walls", "delta-neutral", "Price stays between the put wall and the call wall",
    [L("buy", "put", pwWing), L("sell", "put", pw), L("sell", "call", cw), L("buy", "call", cwWing)], S, T, sigma,
    "Short strikes sit on the biggest OI walls (where writers defend). Defined risk. Take 50% of the credit; exit if price closes beyond a wall."),
    (rich ? 30 : 12) + (bias === "neutral" ? 25 : 8) + (!shortGamma ? 20 : -10) + 10,
    [volWhy, `Short ${pw.strike} put (put wall) / ${cw.strike} call (call wall)`, "Defined risk — the professional's delta-neutral default"]);
  add(evaluate("iron-fly", "Iron butterfly", "delta-neutral", "Price pins near the ATM strike into expiry",
    [L("buy", "put", dn1), L("sell", "put", atm), L("sell", "call", atm), L("buy", "call", up1)], S, T, sigma,
    "Sell the ATM straddle, buy wings one expected move away. Best into expiry with max pain near spot. Take profit at 25–40%."),
    (rich ? 30 : 10) + (bias === "neutral" ? 20 : 0) + (!shortGamma ? 15 : -15) + (m.a.maxPain && Math.abs(m.a.maxPain - S) / S < 0.004 ? 20 : 0),
    [volWhy, m.a.maxPain ? `Max pain ${m.a.maxPain} vs spot ${Math.round(S)}` : "", "Defined-risk straddle"].filter(Boolean));

  // ---- long volatility ----
  add(evaluate("long-straddle", "Long straddle", "volatility", "A big move either way (event, breakout)",
    [L("buy", "call", atm), L("buy", "put", atm)], S, T, sigma,
    "Buy before an expected event when IV is cheap. Exit on the move or if IV rises; theta costs you every day you wait."),
    (cheap ? 45 : 5) + (shortGamma ? 25 : 0) + 10,
    [volWhy, shortGamma ? "Dealers short gamma: moves can extend" : "Dealers long gamma: moves tend to get damped"]);
  add(evaluate("long-strangle", "Long strangle", "volatility", "A very large move either way",
    [L("buy", "call", up1), L("buy", "put", dn1)], S, T, sigma,
    "Cheaper than the straddle but needs a bigger move. Keep it small; most expire worthless."),
    (cheap ? 38 : 3) + (shortGamma ? 20 : 0),
    [volWhy]);

  // ---- directional ----
  const bullish = bias === "bullish", bearish = bias === "bearish";
  add(evaluate("bull-put", "Bull put spread (credit)", "directional", "Price holds above the put wall",
    [L("sell", "put", pw), L("buy", "put", pwWing)], S, T, sigma,
    "Short put on the put wall (writers' support). Take 50–70% of the credit; exit on a close below the short strike."),
    (bullish ? 40 : bearish ? 0 : 15) + (rich ? 25 : 5) + 10,
    [volWhy, `Chain bias: ${bias}`, `Support at the ${pw.strike} put wall`]);
  add(evaluate("bear-call", "Bear call spread (credit)", "directional", "Price stays below the call wall",
    [L("sell", "call", cw), L("buy", "call", cwWing)], S, T, sigma,
    "Short call on the call wall (writers' resistance). Take 50–70% of the credit; exit on a close above the short strike."),
    (bearish ? 40 : bullish ? 0 : 15) + (rich ? 25 : 5) + 10,
    [volWhy, `Chain bias: ${bias}`, `Resistance at the ${cw.strike} call wall`]);
  add(evaluate("bull-call", "Bull call spread (debit)", "directional", "A move up toward the call wall",
    [L("buy", "call", atm), L("sell", "call", up1)], S, T, sigma,
    "Buy ATM, sell one expected move higher. Exit at the short strike or if price closes back below the entry."),
    (bullish ? 40 : 0) + (cheap ? 25 : rich ? 0 : 10),
    [volWhy, `Chain bias: ${bias}`]);
  add(evaluate("bear-put", "Bear put spread (debit)", "directional", "A move down toward the put wall",
    [L("buy", "put", atm), L("sell", "put", dn1)], S, T, sigma,
    "Buy ATM put, sell one expected move lower. Exit at the short strike or on a close back above the entry."),
    (bearish ? 40 : 0) + (cheap ? 25 : rich ? 0 : 10),
    [volWhy, `Chain bias: ${bias}`]);

  return list
    .filter((x): x is [Omit<Strategy, "fit" | "why">, number, string[]] => !!x[0])
    .map(([s, fit, why]) => ({ ...s, fit: Math.max(0, Math.min(100, Math.round(fit))), why }))
    .sort((a, b) => b.fit - a.fit);
}

/** Annualised realised volatility from daily closes (close-to-close, last n days). */
export function realisedVol(closes: number[], n = 30, periodsPerYear = 252) {
  const c = closes.slice(-(n + 1));
  if (c.length < 10) return null;
  const r = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * periodsPerYear);
}
