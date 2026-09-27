// Pure indicator maths. No I/O, no dates, no framework: every function takes
// plain arrays and returns plain arrays, so the rules built on top can be
// tested against hand-worked numbers.

export type Candle = {
  t: number; // unix seconds, bar open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** Exponential moving average, seeded with the simple average of the first `n` values. */
export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Simple moving average over the `n` values ending at each index. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** RSI with Wilder's smoothing, the standard 14-period definition. */
export function rsi(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const val = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[n] = val(gain, loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val(gain, loss);
  }
  return out;
}

/**
 * Average True Range with Wilder's smoothing: how far the stock normally moves
 * in a day, gaps included. Used to keep stops outside ordinary noise.
 */
export function atr(cs: Candle[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(cs.length).fill(null);
  if (cs.length <= n) return out;
  const tr = cs.map((c, i) =>
    i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c)),
  );
  let a = tr.slice(1, n + 1).reduce((x, y) => x + y, 0) / n;
  out[n] = a;
  for (let i = n + 1; i < cs.length; i++) {
    a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}

/** Lowest low and highest high over the `n` bars before index `i` (excluding `i`). */
export function swing(candles: Candle[], i: number, n = 10): { low: number; high: number } {
  const from = Math.max(0, i - n);
  const win = candles.slice(from, i);
  if (!win.length) return { low: candles[i].l, high: candles[i].h };
  return {
    low: Math.min(...win.map((c) => c.l)),
    high: Math.max(...win.map((c) => c.h)),
  };
}

// ---- candle patterns (the "Cheat Code" sheet) -------------------------------

export type Pattern = { name: string; bias: "bullish" | "bearish" | "neutral" };

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => c.h - c.l || 1e-9;
const upper = (c: Candle) => c.h - Math.max(c.o, c.c);
const lower = (c: Candle) => Math.min(c.o, c.c) - c.l;
const green = (c: Candle) => c.c > c.o;
const red = (c: Candle) => c.c < c.o;

/** Patterns completed by the candle at index `i`. Definitions are the textbook ones. */
export function patternsAt(cs: Candle[], i: number): Pattern[] {
  const out: Pattern[] = [];
  const c = cs[i];
  const p = cs[i - 1];
  const pp = cs[i - 2];
  if (!c) return out;

  // single-candle
  if (body(c) <= 0.1 * range(c)) {
    if (lower(c) >= 0.6 * range(c)) out.push({ name: "Dragonfly Doji", bias: "bullish" });
    else if (upper(c) >= 0.6 * range(c)) out.push({ name: "Gravestone Doji", bias: "bearish" });
    else out.push({ name: "Doji", bias: "neutral" });
  } else {
    const small = body(c) <= 0.35 * range(c);
    if (small && lower(c) >= 2 * body(c) && upper(c) <= body(c)) {
      out.push({ name: "Hammer", bias: "bullish" });
    }
    if (small && upper(c) >= 2 * body(c) && lower(c) <= body(c)) {
      out.push({ name: "Shooting Star", bias: "bearish" });
    }
    if (body(c) >= 0.9 * range(c)) {
      out.push(green(c) ? { name: "Bullish Marubozu", bias: "bullish" } : { name: "Bearish Marubozu", bias: "bearish" });
    }
  }

  // two-candle
  if (p) {
    if (red(p) && green(c) && c.o <= p.c && c.c >= p.o && body(c) > body(p)) {
      out.push({ name: "Bullish Engulfing", bias: "bullish" });
    }
    if (green(p) && red(c) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) {
      out.push({ name: "Bearish Engulfing", bias: "bearish" });
    }
    if (red(p) && green(c) && c.o < p.l && c.c > (p.o + p.c) / 2 && c.c < p.o) {
      out.push({ name: "Piercing Line", bias: "bullish" });
    }
    if (green(p) && red(c) && c.o > p.h && c.c < (p.o + p.c) / 2 && c.c > p.o) {
      out.push({ name: "Dark Cloud Cover", bias: "bearish" });
    }
  }

  // three-candle
  if (p && pp) {
    const smallMid = body(p) <= 0.35 * range(p);
    if (red(pp) && smallMid && green(c) && c.c > (pp.o + pp.c) / 2) {
      out.push({ name: "Morning Star", bias: "bullish" });
    }
    if (green(pp) && smallMid && red(c) && c.c < (pp.o + pp.c) / 2) {
      out.push({ name: "Evening Star", bias: "bearish" });
    }
    if ([pp, p, c].every(green) && p.c > pp.c && c.c > p.c) {
      out.push({ name: "Three White Soldiers", bias: "bullish" });
    }
    if ([pp, p, c].every(red) && p.c < pp.c && c.c < p.c) {
      out.push({ name: "Three Black Crows", bias: "bearish" });
    }
  }
  return out;
}
