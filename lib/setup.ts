// Setup rules, version 2. Built from the "Indicator Setup" sheet and tightened
// where the journal shows the sheet let bad trades through.
//
// Timeframe: daily candles, aiming at 3–10 day moves.
//
// From the sheet (unchanged):
//   Long:  price above the 50 EMA; pullback to the 20 EMA without breaking the 50;
//          RSI 40–50 and turning up; a bullish candle closing near the 20 EMA;
//          volume above its 20-day average.
//   Short: the mirror image, RSI 50–60 and turning down.
//
// Added in v2:
//   Market with you — the index (NIFTY 50 / S&P 500) is above its own 50 EMA for
//     a long, below it for a short. The sheet only checked the stock's trend; the
//     journal's worst days were trades against the bigger trend.
//   Stronger than the index — over ~3 months the stock beat its index (long) or
//     lagged it (short). Pullbacks in laggards tend to keep lagging.
//   ATR — how far the stock normally moves in a day, used by the plan to keep the
//     stop out of ordinary noise (the 19-08 "SL at the wrong spot" loss).
//
// Required for "Setup ready": trend, pullback, RSI, candle, market.
// "Setup confirmed" also needs volume and relative strength.
//
// Nothing here predicts anything. It reports which rules the latest completed
// daily candle meets.

import { atr, Candle, ema, patternsAt, Pattern, rsi, sma, swing } from "./indicators";

export type Side = "long" | "short";
export type Rule = { id: string; label: string; pass: boolean; detail: string };
export type Status = "confirmed" | "ready" | "watch" | "none";

export type SideResult = {
  side: Side;
  status: Status;
  rules: Rule[];
};

export type Analysis = {
  last: Candle;
  prevClose: number;
  ema20: number;
  ema50: number;
  rsi: number;
  rsiPrev: number;
  volAvg20: number;
  high52: number;
  low52: number;
  rangePos: number; // 0 = at 52-week low, 1 = at 52-week high
  atr14: number;
  ret63: number; // stock return over ~3 months, %
  indexRet63: number | null; // index return over the same window, %
  indexAbove50: boolean | null; // null when index data is unavailable
  swingLow: number;
  swingHigh: number;
  patterns: Pattern[];
  long: SideResult;
  short: SideResult;
  best: SideResult; // the side with the stronger status, long on ties
};

/** How close counts as "near the 20 EMA": within this fraction of it. */
export const NEAR = 0.015;

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const f = (n: number, d = 2) => n.toFixed(d);

const REQUIRED = ["trend", "pullback", "rsi", "candle", "market"];
const CONFIRM = ["volume", "strength"];

function statusOf(rules: Rule[]): Status {
  const ok = (id: string) => rules.find((r) => r.id === id)?.pass === true;
  if (REQUIRED.every(ok)) return CONFIRM.every(ok) ? "confirmed" : "ready";
  if (ok("trend") && ok("pullback")) return "watch";
  return "none";
}

/** The index's context for a market: is it above its 50 EMA, and its ~3-month return. */
export type IndexContext = { above50: boolean; ret63: number } | null;

export function indexContext(candles: Candle[] | null): IndexContext {
  if (!candles || candles.length < 64) return null;
  const closes = candles.map((c) => c.c);
  const e50 = ema(closes, 50);
  const i = closes.length - 1;
  return { above50: closes[i] > e50[i]!, ret63: ((closes[i] - closes[i - 63]) / closes[i - 63]) * 100 };
}

const RANK: Record<Status, number> = { confirmed: 3, ready: 2, watch: 1, none: 0 };

export function analyse(candles: Candle[], index: IndexContext = null): Analysis | null {
  // 50 EMA needs 50 bars to settle, the 3-month return needs 64; RSI needs 15.
  if (candles.length < 70) return null;

  const closes = candles.map((c) => c.c);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const vAvg = sma(candles.map((c) => c.v), 20);

  const i = candles.length - 1;
  const last = candles[i];
  const prev = candles[i - 1];
  const ema20 = e20[i]!;
  const ema50 = e50[i]!;
  const rsiNow = r[i]!;
  const rsiPrev = r[i - 1]!;
  // average of the 20 sessions BEFORE today, so today's spike is measured against them
  const volAvg20 = vAvg[i - 1] ?? vAvg[i]!;

  const year = candles.slice(-252);
  const high52 = Math.max(...year.map((c) => c.h));
  const low52 = Math.min(...year.map((c) => c.l));
  const rangePos = high52 === low52 ? 0.5 : (last.c - low52) / (high52 - low52);
  const sw = swing(candles, i, 10);
  const patterns = patternsAt(candles, i);
  const atr14 = atr(candles, 14)[i]!;
  const ret63 = ((last.c - closes[i - 63]) / closes[i - 63]) * 100;
  const indexAbove50 = index ? index.above50 : null;
  const indexRet63 = index ? index.ret63 : null;
  const rs = indexRet63 === null ? null : ret63 - indexRet63;
  const noIndex = "Index data unavailable — treated as not passing";

  // "Pullback" looks at the last three candles, not only today's, because a
  // touch of the 20 EMA yesterday followed by a bounce today is the setup.
  const recent = candles.slice(-3);
  const recentE20 = e20.slice(-3) as number[];
  const recentE50 = e50.slice(-3) as number[];
  const recentRsi = r.slice(-3) as number[];

  // ---- long ----------------------------------------------------------------
  const lTouched = recent.some((c, k) => c.l <= recentE20[k] * (1 + NEAR));
  const lHeld = recent.every((c, k) => c.c > recentE50[k]);
  const lRsiZone = Math.min(...recentRsi) >= 38 && Math.min(...recentRsi) <= 52;
  const long: Rule[] = [
    {
      id: "trend",
      label: "Price above 50 EMA",
      pass: last.c > ema50,
      detail: `Close ${f(last.c)} vs 50 EMA ${f(ema50)} (${f(pct(last.c, ema50), 1)}%)`,
    },
    {
      id: "pullback",
      label: "Pulled back to 20 EMA, held the 50",
      pass: lTouched && lHeld,
      detail: lTouched
        ? lHeld
          ? `Touched the 20 EMA (${f(ema20)}) in the last 3 sessions and closed above the 50 every time`
          : `Touched the 20 EMA but closed below the 50 EMA — the pullback broke`
        : `No low within ${NEAR * 100}% of the 20 EMA (${f(ema20)}) in the last 3 sessions`,
    },
    {
      id: "rsi",
      label: "RSI 40–50, turning up",
      pass: lRsiZone && rsiNow > rsiPrev,
      detail: `RSI ${f(rsiNow, 1)} (yesterday ${f(rsiPrev, 1)}), 3-day low ${f(Math.min(...recentRsi), 1)}`,
    },
    {
      id: "candle",
      label: "Bullish candle closed near 20 EMA",
      pass: last.c > last.o && Math.abs(last.c - ema20) / ema20 <= NEAR * 2,
      detail: last.c > last.o
        ? `Green candle, close ${f(Math.abs(pct(last.c, ema20)), 1)}% from the 20 EMA`
        : `Last candle closed red`,
    },
    {
      id: "volume",
      label: "Volume above 20-day average",
      pass: last.v > volAvg20,
      detail: `${fmtVol(last.v)} vs average ${fmtVol(volAvg20)} (${f((last.v / volAvg20) * 100, 0)}%)`,
    },
    {
      id: "market",
      label: "Market with you (index above its 50 EMA)",
      pass: indexAbove50 === true,
      detail: indexAbove50 === null ? noIndex : indexAbove50 ? "Index is in an uptrend" : "Index is below its 50 EMA — longs fight the market",
    },
    {
      id: "strength",
      label: "Stronger than the index (3 months)",
      pass: rs !== null && rs > 0,
      detail: rs === null ? noIndex : `Stock ${f(ret63, 1)}% vs index ${f(indexRet63!, 1)}% (${rs >= 0 ? "+" : ""}${f(rs, 1)} pts)`,
    },
  ];

  // ---- short ---------------------------------------------------------------
  const sTouched = recent.some((c, k) => c.h >= recentE20[k] * (1 - NEAR));
  const sFailed = recent.every((c, k) => c.c < recentE50[k]) && last.c < ema20;
  const sRsiZone = Math.max(...recentRsi) >= 48 && Math.max(...recentRsi) <= 62;
  const short: Rule[] = [
    {
      id: "trend",
      label: "Price below 50 EMA",
      pass: last.c < ema50,
      detail: `Close ${f(last.c)} vs 50 EMA ${f(ema50)} (${f(pct(last.c, ema50), 1)}%)`,
    },
    {
      id: "pullback",
      label: "Rallied to 20 EMA and failed",
      pass: sTouched && sFailed,
      detail: sTouched
        ? sFailed
          ? `Reached the 20 EMA (${f(ema20)}) and closed back below it`
          : `Reached the 20 EMA but has not failed there yet`
        : `No high within ${NEAR * 100}% of the 20 EMA (${f(ema20)}) in the last 3 sessions`,
    },
    {
      id: "rsi",
      label: "RSI 50–60, turning down",
      pass: sRsiZone && rsiNow < rsiPrev,
      detail: `RSI ${f(rsiNow, 1)} (yesterday ${f(rsiPrev, 1)}), 3-day high ${f(Math.max(...recentRsi), 1)}`,
    },
    {
      id: "candle",
      label: "Bearish candle closed near 20 EMA",
      pass: last.c < last.o && Math.abs(last.c - ema20) / ema20 <= NEAR * 2,
      detail: last.c < last.o
        ? `Red candle, close ${f(Math.abs(pct(last.c, ema20)), 1)}% from the 20 EMA`
        : `Last candle closed green`,
    },
    {
      id: "volume",
      label: "Volume above 20-day average",
      pass: last.v > volAvg20,
      detail: `${fmtVol(last.v)} vs average ${fmtVol(volAvg20)} (${f((last.v / volAvg20) * 100, 0)}%)`,
    },
    {
      id: "market",
      label: "Market with you (index below its 50 EMA)",
      pass: indexAbove50 === false,
      detail: indexAbove50 === null ? noIndex : indexAbove50 ? "Index is in an uptrend — shorts fight the market" : "Index is in a downtrend",
    },
    {
      id: "strength",
      label: "Weaker than the index (3 months)",
      pass: rs !== null && rs < 0,
      detail: rs === null ? noIndex : `Stock ${f(ret63, 1)}% vs index ${f(indexRet63!, 1)}% (${rs >= 0 ? "+" : ""}${f(rs, 1)} pts)`,
    },
  ];

  const L: SideResult = { side: "long", status: statusOf(long), rules: long };
  const S: SideResult = { side: "short", status: statusOf(short), rules: short };
  const best = RANK[S.status] > RANK[L.status] ? S : L;

  return {
    last,
    prevClose: prev.c,
    ema20,
    ema50,
    rsi: rsiNow,
    rsiPrev,
    volAvg20,
    high52,
    low52,
    rangePos,
    atr14,
    ret63,
    indexRet63,
    indexAbove50,
    swingLow: sw.low,
    swingHigh: sw.high,
    patterns,
    long: L,
    short: S,
    best,
  };
}

export function fmtVol(v: number): string {
  if (v >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(2) + " L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v));
}

export const STATUS_LABEL: Record<Status, string> = {
  confirmed: "Setup confirmed",
  ready: "Setup ready",
  watch: "Watch",
  none: "No setup",
};
