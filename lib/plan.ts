// Entry, stop, target and size — the "Entry Point", "Stop-Loss" and "Target"
// blocks of the Indicator Setup sheet, as arithmetic.
//
// Long:  enter above the signal candle's high; stop below the recent swing low
//        (or a fixed 1.5–2%); target at 1:2 risk-reward.
//        v2 default ("smart"): the swing-low stop, pushed further away if needed so
//        it sits at least 1 ATR from the entry — outside a normal day's movement.
// Short: enter below the signal candle's low; stop above the swing high.
// Size:  as many shares as keep the loss at the stop within your risk budget,
//        never more than your capital can buy.

import type { Side } from "./setup";

export type Market = "IN" | "US";
export type StopMode = "smart" | "swing" | "fixed";

export type PlanInput = {
  side: Side;
  market: Market;
  signalHigh: number;
  signalLow: number;
  swingLow: number;
  swingHigh: number;
  capital: number; // in the market's own currency
  riskPct: number; // % of capital you accept losing on this trade
  stopMode: StopMode;
  fixedStopPct: number; // used when stopMode = "fixed"
  atr: number; // 14-day ATR, used when stopMode = "smart"
  atrMult: number; // minimum stop distance in ATRs for "smart", 1 by default
  rr: number; // reward multiple of risk, 2 = 1:2
};

export type Plan = {
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
  qty: number;
  capitalUsed: number;
  maxLoss: number;
  maxGain: number;
  stopPct: number;
  cappedByCapital: boolean;
  breakevenAt: number; // price at +1R, where the stop moves to entry
  warnings: string[];
};

// NSE equities trade in ₹0.05 steps; US equities in $0.01.
export const tick = (m: Market) => (m === "IN" ? 0.05 : 0.01);
const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const clean = (x: number, m: Market) => Number(roundTo(x, tick(m)).toFixed(2));

export function plan(p: PlanInput): Plan {
  const t = tick(p.market);
  const warnings: string[] = [];
  const long = p.side === "long";

  const entry = clean(long ? p.signalHigh + t : p.signalLow - t, p.market);

  let stop: number;
  if (p.stopMode === "fixed") {
    stop = long ? entry * (1 - p.fixedStopPct / 100) : entry * (1 + p.fixedStopPct / 100);
  } else {
    stop = long ? p.swingLow - t : p.swingHigh + t;
    if (p.stopMode === "smart" && p.atr > 0) {
      const minGap = p.atrMult * p.atr;
      stop = long ? Math.min(stop, entry - minGap) : Math.max(stop, entry + minGap);
    }
  }
  stop = clean(stop, p.market);

  const riskPerShare = Math.abs(entry - stop);
  const stopPct = (riskPerShare / entry) * 100;
  if (riskPerShare <= 0 || (long ? stop >= entry : stop <= entry)) {
    return {
      entry, stop, target: entry, riskPerShare: 0, qty: 0, capitalUsed: 0,
      maxLoss: 0, maxGain: 0, stopPct: 0, cappedByCapital: false, breakevenAt: entry,
      warnings: ["The stop is on the wrong side of the entry — no valid plan from this candle."],
    };
  }
  if (stopPct > 5) warnings.push(`Stop is ${stopPct.toFixed(1)}% away — wider than a 3–10 day swing usually needs.`);
  if (stopPct < 0.5) warnings.push(`Stop is only ${stopPct.toFixed(2)}% away — normal noise can hit it.`);

  const target = clean(long ? entry + p.rr * riskPerShare : entry - p.rr * riskPerShare, p.market);

  // Whole shares on NSE; US brokers commonly allow fractions, kept to 2 decimals.
  const unit = p.market === "IN" ? 1 : 0.01;
  const budget = (p.capital * p.riskPct) / 100;
  let qty = Math.floor(budget / riskPerShare / unit) * unit;
  let cappedByCapital = false;
  if (qty * entry > p.capital) {
    qty = Math.floor(p.capital / entry / unit) * unit;
    cappedByCapital = true;
  }
  qty = Number(qty.toFixed(2));
  if (qty <= 0) warnings.push("Your risk budget is smaller than the risk on a single share at this stop.");

  return {
    entry,
    stop,
    target,
    riskPerShare: Number(riskPerShare.toFixed(2)),
    qty,
    capitalUsed: Number((qty * entry).toFixed(2)),
    maxLoss: Number((qty * riskPerShare).toFixed(2)),
    maxGain: Number((qty * riskPerShare * p.rr).toFixed(2)),
    stopPct: Number(stopPct.toFixed(2)),
    cappedByCapital,
    breakevenAt: clean(long ? entry + riskPerShare : entry - riskPerShare, p.market),
    warnings,
  };
}

/** Result of a closed trade in R: +2 means it made twice what it risked. */
export function resultR(side: Side, entry: number, stop: number, exit: number): number {
  const risk = Math.abs(entry - stop);
  if (!risk) return 0;
  const move = side === "long" ? exit - entry : entry - exit;
  return Number((move / risk).toFixed(2));
}
