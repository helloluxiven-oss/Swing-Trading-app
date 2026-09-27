// Ranking for the dashboard: how close each stock is to your setup.
//
// This is NOT a buy signal. A stock is tradeable only when its status is
// "ready" or "confirmed" (all five required rules pass). The score orders
// everything else by how near it is, so the list says "closest to a setup —
// wait" instead of pretending ten stocks are buys every day.
//
// Points (best side only): trend 25, pullback 20, RSI 15, candle 10, market 10
// — the five required rules, 80 in total — then volume 10 and relative
// strength 10 for confirmation. Ties break on relative strength vs the index.

import type { Analysis, Rule, Status } from "./setup";

export const WEIGHTS: Record<string, number> = {
  trend: 25,
  pullback: 20,
  rsi: 15,
  candle: 10,
  market: 10,
  volume: 10,
  strength: 10,
};

export function scoreRules(rules: Rule[]): number {
  return rules.reduce((s, r) => s + (r.pass ? WEIGHTS[r.id] ?? 0 : 0), 0);
}

export const tradeable = (s: Status) => s === "ready" || s === "confirmed";

export type Ranked<T> = T & { score: number; rs: number | null; tradeable: boolean };

export function rank<T extends { analysis: Analysis | null }>(rows: T[], limit = 10): Ranked<T>[] {
  return rows
    .filter((r) => r.analysis)
    .map((r) => {
      const a = r.analysis!;
      return {
        ...r,
        score: scoreRules(a.best.rules),
        rs: a.indexRet63 === null ? null : a.ret63 - a.indexRet63,
        tradeable: tradeable(a.best.status),
      };
    })
    .sort((x, y) => Number(y.tradeable) - Number(x.tradeable) || y.score - x.score || (y.rs ?? -1e9) - (x.rs ?? -1e9))
    .slice(0, limit);
}

/**
 * Exit watch for a position you already hold, straight from the sheet's
 * "Target (Exit)" and trend rules: take profit into RSI 70; the trend is broken
 * on a close below the 50 EMA; a close below the 20 EMA is an early warning.
 */
export type ExitSignal = { level: "take-profit" | "broken" | "caution" | "ok"; text: string };

export function exitWatch(a: Analysis, side: "long" | "short" = "long"): ExitSignal[] {
  const out: ExitSignal[] = [];
  const c = a.last.c;
  if (side === "long") {
    if (a.rsi >= 70) out.push({ level: "take-profit", text: `RSI ${a.rsi.toFixed(1)} — at or above 70. Your rule: exit longs when RSI reaches 70.` });
    if (c < a.ema50) out.push({ level: "broken", text: `Closed below the 50 EMA (${a.ema50.toFixed(2)}) — the uptrend your trade relies on is broken.` });
    else if (c < a.ema20) out.push({ level: "caution", text: `Closed below the 20 EMA (${a.ema20.toFixed(2)}) — watch the 50 EMA and the swing low (${a.swingLow.toFixed(2)}).` });
  } else {
    if (a.rsi <= 30) out.push({ level: "take-profit", text: `RSI ${a.rsi.toFixed(1)} — at or below 30. Your rule: exit shorts when RSI reaches 30.` });
    if (c > a.ema50) out.push({ level: "broken", text: `Closed above the 50 EMA — the downtrend is broken.` });
    else if (c > a.ema20) out.push({ level: "caution", text: `Closed above the 20 EMA — early warning.` });
  }
  if (!out.length) out.push({ level: "ok", text: side === "long" ? "Trend intact: above both EMAs, RSI below 70. Let it run to your target." : "Trend intact for the short." });
  return out;
}
