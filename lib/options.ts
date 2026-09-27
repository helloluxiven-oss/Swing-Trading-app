// Options analytics shared by the India (NIFTY / SENSEX) and crypto (BTC / ETH)
// desks. Pure functions, so they are tested against hand-worked numbers.
//
// From one option chain (per strike: call & put open interest, implied vol,
// price) this produces what a derivatives trader reads first:
//   · Put/Call ratio (by OI) and its change      → positioning
//   · Max pain                                   → where option writers lose least at expiry
//   · Call wall / put wall (highest OI strikes)  → likely resistance / support
//   · Expected move from the ATM straddle        → the range the market is pricing
//   · ATM IV and skew (OTM put IV − OTM call IV)  → fear vs greed
//   · Greeks per strike (Black-Scholes)          → delta, gamma, theta, vega
//   · Dealer gamma exposure (GEX) by strike      → where moves get damped or amplified
// and turns them into plain-language reads. None of it is a prediction.

export type ChainRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callOIChg?: number;
  putOIChg?: number;
  callIV: number | null; // decimal, 0.18 = 18%
  putIV: number | null;
  callPrice: number | null;
  putPrice: number | null;
  callVolume?: number;
  putVolume?: number;
};

export type Greeks = { delta: number; gamma: number; theta: number; vega: number };

// ---- Black-Scholes ------------------------------------------------------------

function erf(x: number) {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const n = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Greeks for one option. S spot/forward, K strike, T years, sigma decimal IV,
 * r risk-free rate. theta is per calendar day, vega per 1 vol point (1%).
 */
export function greeks(type: "call" | "put", S: number, K: number, T: number, sigma: number, r = 0): Greeks {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return { delta: type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0 };
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sq);
  const d2 = d1 - sigma * sq;
  const gamma = n(d1) / (S * sigma * sq);
  const vega = (S * n(d1) * sq) / 100;
  const common = (-S * n(d1) * sigma) / (2 * sq);
  const theta =
    type === "call" ? (common - r * K * Math.exp(-r * T) * N(d2)) / 365 : (common + r * K * Math.exp(-r * T) * N(-d2)) / 365;
  return { delta: type === "call" ? N(d1) : N(d1) - 1, gamma, theta, vega };
}

export function bsPrice(type: "call" | "put", S: number, K: number, T: number, sigma: number, r = 0) {
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sq);
  const d2 = d1 - sigma * sq;
  return type === "call" ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
}

// ---- chain analytics ------------------------------------------------------------

/** Strike where the total payout to option buyers at expiry is smallest. */
export function maxPain(rows: ChainRow[]): number | null {
  if (!rows.length) return null;
  let best: number | null = null, low = Infinity;
  for (const x of rows) {
    let pay = 0;
    for (const k of rows) pay += k.callOI * Math.max(0, x.strike - k.strike) + k.putOI * Math.max(0, k.strike - x.strike);
    if (pay < low) { low = pay; best = x.strike; }
  }
  return best;
}

export const pcr = (rows: ChainRow[]) => {
  const c = rows.reduce((s, r) => s + r.callOI, 0), p = rows.reduce((s, r) => s + r.putOI, 0);
  return c ? p / c : null;
};

export function atmStrike(rows: ChainRow[], spot: number) {
  return rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), rows[0])?.strike ?? null;
}

/**
 * Dealer gamma exposure per strike, assuming the usual convention that dealers
 * are long the calls and short the puts customers trade. Positive total =
 * dealers hedge against moves (range, pinning); negative = they chase moves.
 * Units: change in dealer delta (in underlying units × multiplier) per 1% move.
 */
export function gex(rows: ChainRow[], spot: number, T: number, multiplier = 1) {
  return rows.map((r) => {
    const gc = r.callIV ? greeks("call", spot, r.strike, T, r.callIV).gamma : 0;
    const gp = r.putIV ? greeks("put", spot, r.strike, T, r.putIV).gamma : 0;
    const perPct = spot * spot * 0.01 * multiplier;
    return { strike: r.strike, gex: (gc * r.callOI - gp * r.putOI) * perPct };
  });
}

/** Price level where cumulative dealer gamma flips sign (above: dampening, below: amplifying). */
export function gammaFlip(rows: ChainRow[], spot: number, T: number) {
  const g = gex(rows, spot, T).sort((a, b) => a.strike - b.strike);
  let cum = 0, prev: { strike: number; cum: number } | null = null;
  for (const x of g) {
    const next = cum + x.gex;
    if (prev && Math.sign(prev.cum) !== Math.sign(next) && prev.cum !== 0) return x.strike;
    prev = { strike: x.strike, cum: next };
    cum = next;
  }
  return null;
}

export type Analysis = {
  spot: number;
  atm: number | null;
  pcr: number | null;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
  atmIV: number | null;
  skew: number | null; // OTM put IV − OTM call IV, vol points
  expectedMove: number | null; // ± price
  totalGex: number;
  flip: number | null;
  reads: { tone: "bull" | "bear" | "neutral" | "warn"; text: string }[];
  bias: "bullish" | "bearish" | "neutral";
};

/** The full read of one expiry. T in years. */
export function analyseChain(rowsIn: ChainRow[], spot: number, T: number, fmt: (x: number) => string = (x) => x.toLocaleString("en-US")): Analysis {
  const rows = rowsIn.filter((r) => r.callOI + r.putOI > 0).sort((a, b) => a.strike - b.strike);
  const atm = rows.length ? atmStrike(rows, spot) : null;
  const P = pcr(rows);
  const mp = maxPain(rows);
  const callWall = rows.filter((r) => r.strike >= spot).reduce<ChainRow | null>((b, r) => (!b || r.callOI > b.callOI ? r : b), null)?.strike ?? null;
  const putWall = rows.filter((r) => r.strike <= spot).reduce<ChainRow | null>((b, r) => (!b || r.putOI > b.putOI ? r : b), null)?.strike ?? null;
  const a = rows.find((r) => r.strike === atm);
  const atmIV = a ? ((a.callIV ?? 0) + (a.putIV ?? 0)) / ((a.callIV ? 1 : 0) + (a.putIV ? 1 : 0) || 1) || null : null;
  const straddle = a && a.callPrice != null && a.putPrice != null ? a.callPrice + a.putPrice : null;
  const expectedMove = straddle ?? (atmIV ? spot * atmIV * Math.sqrt(T) : null);
  // Skew: IV of the put ~5% below spot minus the call ~5% above.
  const near = (k: number) => rows.reduce<ChainRow | null>((b, r) => (!b || Math.abs(r.strike - k) < Math.abs(b.strike - k) ? r : b), null);
  const pDown = near(spot * 0.95), cUp = near(spot * 1.05);
  const skew = pDown?.putIV && cUp?.callIV ? (pDown.putIV - cUp.callIV) * 100 : null;
  const g = gex(rows, spot, T);
  const totalGex = g.reduce((s, x) => s + x.gex, 0);
  const flip = gammaFlip(rows, spot, T);

  const reads: Analysis["reads"] = [];
  let score = 0;
  if (P != null) {
    if (P > 1.3) { reads.push({ tone: "bull", text: `Put/Call ratio ${P.toFixed(2)} — heavy put writing/hedging; writers are defending the downside (supportive, but crowded above 1.6).` }); score++; }
    else if (P < 0.7) { reads.push({ tone: "bear", text: `Put/Call ratio ${P.toFixed(2)} — calls dominate; writers are capping the upside.` }); score--; }
    else reads.push({ tone: "neutral", text: `Put/Call ratio ${P.toFixed(2)} — balanced positioning.` });
  }
  if (callWall != null && putWall != null) reads.push({ tone: "neutral", text: `Range the option writers are defending: ${fmt(putWall)} (put wall, support) to ${fmt(callWall)} (call wall, resistance).` });
  if (mp != null) {
    const d = ((mp - spot) / spot) * 100;
    reads.push({ tone: Math.abs(d) < 0.3 ? "neutral" : d > 0 ? "bull" : "bear", text: `Max pain ${fmt(mp)} (${d >= 0 ? "+" : ""}${d.toFixed(2)}% from spot) — expiry often gravitates here when nothing else is driving price.` });
    score += Math.abs(d) < 0.3 ? 0 : d > 0 ? 0.5 : -0.5;
  }
  if (expectedMove) reads.push({ tone: "neutral", text: `The market is pricing about ±${fmt(expectedMove)} (±${((expectedMove / spot) * 100).toFixed(2)}%) by this expiry — ${fmt(spot - expectedMove)} to ${fmt(spot + expectedMove)}.` });
  if (skew != null) {
    if (skew > 3) { reads.push({ tone: "warn", text: `Put skew +${skew.toFixed(1)} vol pts — downside protection is expensive; the market is nervous.` }); score -= 0.5; }
    else if (skew < -1) { reads.push({ tone: "bull", text: `Call skew ${skew.toFixed(1)} vol pts — upside calls in demand (chasing / squeeze risk).` }); score += 0.5; }
    else reads.push({ tone: "neutral", text: `Skew ${skew.toFixed(1)} vol pts — no strong fear or greed in the smile.` });
  }
  if (rows.length) {
    reads.push(
      totalGex >= 0
        ? { tone: "neutral", text: `Dealers net long gamma${flip ? ` above ${fmt(flip)}` : ""} — they sell rallies and buy dips: expect ranges and pinning near big strikes.` }
        : { tone: "warn", text: `Dealers net short gamma${flip ? ` below ${fmt(flip)}` : ""} — their hedging chases price: moves can extend fast in either direction.` },
    );
  }
  const bias = score >= 1 ? "bullish" : score <= -1 ? "bearish" : "neutral";
  return { spot, atm, pcr: P, maxPain: mp, callWall, putWall, atmIV, skew, expectedMove, totalGex, flip, reads, bias };
}

/** Years from now until an expiry timestamp (seconds), floored at one hour. */
export const yearsTo = (expiry: number, now = Date.now() / 1000) => Math.max(expiry - now, 3600) / (365 * 86400);
