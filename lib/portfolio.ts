// Portfolio history from daily closes — pure, so it can be tested.
//
// For every day since your first buy: what your holdings were worth, what you
// had put in, and what the same money would be worth had each buy gone into the
// index (NIFTY 50 for Indian stocks, S&P 500 for US) on the same day. That last
// line answers the only question that matters for a portfolio: are you beating
// just buying the index?
//
// Everything is in rupees. US values use today's USD/INR for the whole history,
// so currency moves are left out on purpose — the chart shows stock picking,
// not the rupee.

import type { Candle } from "./indicators";

export type HoldingSeries = {
  qty: number;
  avg: number;
  boughtOn: number | null; // unix seconds, null = held before the data starts
  fx: number; // multiplier into INR (1 for Indian stocks)
  candles: Candle[];
  bench: Candle[];
};

export type HistoryPoint = { t: number; value: number; invested: number; bench: number };

const DAY = 86400;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

/** Close on or before day `d` (forward-filled), or null before the first candle. */
function closeAt(cs: Candle[], d: number, from: { i: number }): number | null {
  while (from.i + 1 < cs.length && dayOf(cs[from.i + 1].t) <= d) from.i++;
  return cs.length && dayOf(cs[from.i].t) <= d ? cs[from.i].c : null;
}

export function portfolioHistory(hs: HoldingSeries[]): HistoryPoint[] {
  const usable = hs.filter((h) => h.candles.length);
  if (!usable.length) return [];
  const days = new Set<number>();
  for (const h of usable) for (const c of h.candles) days.add(dayOf(c.t));
  const sorted = [...days].sort((a, b) => a - b);

  // Units of the index each buy would have bought, at the index close on the buy day.
  const benchUnits = usable.map((h) => {
    const start = Math.max(dayOf(h.boughtOn ?? 0), dayOf(h.candles[0].t));
    const c = closeAt(h.bench, start, { i: 0 });
    return c ? (h.qty * h.avg) / c : 0;
  });

  const cur = usable.map(() => ({ i: 0 }));
  const bcur = usable.map(() => ({ i: 0 }));
  const firstDay = Math.min(...usable.map((h) => Math.max(dayOf(h.boughtOn ?? 0), dayOf(h.candles[0].t))));
  const out: HistoryPoint[] = [];
  for (const d of sorted) {
    if (d < firstDay) continue;
    let value = 0, invested = 0, bench = 0;
    usable.forEach((h, k) => {
      const held = d >= Math.max(dayOf(h.boughtOn ?? 0), dayOf(h.candles[0].t));
      const c = closeAt(h.candles, d, cur[k]);
      const b = closeAt(h.bench, d, bcur[k]);
      if (!held || c === null) return;
      value += h.qty * c * h.fx;
      invested += h.qty * h.avg * h.fx;
      bench += benchUnits[k] * (b ?? 0) * h.fx;
    });
    if (invested > 0) out.push({ t: d, value, invested, bench });
  }
  return out;
}

/** Largest peak-to-trough fall of the value line, in % (a negative number or 0). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity, worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.min(worst, ((v - peak) / peak) * 100);
  }
  return worst;
}
