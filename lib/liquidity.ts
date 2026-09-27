// Previous-session liquidity sweep — the intraday XAUUSD strategy.
//
// Sessions (New York time, as in the chart's session indicator):
//   Asia 20:00–03:00 · London 03:00–07:00 · New York 08:00–12:00
//
// Idea: resting orders sit above the previous session's high and below its
// low. When the current session runs one side (the sweep), fails to hold
// beyond it (closes back inside) and then breaks the last swing in the other
// direction (market-structure shift), the move was a liquidity grab: trade
// back toward the opposite side of the previous session.
//
//   Sweep of the HIGH → reclaim below it → close below the last swing low → SHORT
//   Sweep of the LOW  → reclaim above it → close above the last swing high → LONG
//
// Entry: limit at the broken swing (the retest). Stop: beyond the sweep
// extreme plus a buffer. TP1 at 1:2, TP2 at the opposite side of the
// previous session. Both sides swept = no clean story, stand aside.
//
// Only closed 5-minute candles are used; the forming one is ignored.

import type { Candle } from "./indicators";
import { atr } from "./indicators";

export type SessionName = "Asia" | "London" | "New York";
export const SESSIONS: { name: SessionName; start: number; end: number; color: string }[] = [
  { name: "Asia", start: 20 * 60, end: 3 * 60, color: "rgba(96,165,250,0.10)" },
  { name: "London", start: 3 * 60, end: 7 * 60, color: "rgba(34,197,94,0.10)" },
  { name: "New York", start: 8 * 60, end: 12 * 60, color: "rgba(244,114,182,0.12)" },
];
export const TZ = "America/New_York";

export type SessionBox = { name: SessionName; firstI: number; lastI: number; high: number; low: number; highI: number; lowI: number; complete: boolean };

export type Stage = "waiting" | "swept" | "reclaimed" | "ready" | "triggered" | "invalidated" | "done" | "both" | "no-data";

export type LiquidityPlan = {
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;
  rrTp2: number;
};

export type LiquidityResult = {
  stage: Stage;
  headline: string;
  action: string;
  steps: { label: string; done: boolean; detail: string }[];
  current: SessionName | null;
  prev: SessionBox | null;
  sessions: SessionBox[];
  sweep: { side: "high" | "low"; i: number; extreme: number; extremeI: number } | null;
  mss: { level: number; i: number | null } | null;
  plan: LiquidityPlan | null;
  pdh: number | null;
  pdl: number | null;
  last: Candle;
  atr: number;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function nyParts(t: number, tz = TZ) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { minutes: hour * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

export function sessionAt(t: number, tz = TZ): SessionName | null {
  const m = nyParts(t, tz).minutes;
  for (const s of SESSIONS) {
    const inside = s.start < s.end ? m >= s.start && m < s.end : m >= s.start || m < s.end;
    if (inside) return s.name;
  }
  return null;
}

/** Group consecutive candles into session boxes. A gap over 3h starts a new box. */
export function sessionBoxes(cs: Candle[], tz = TZ): SessionBox[] {
  const out: SessionBox[] = [];
  let cur: SessionBox | null = null;
  cs.forEach((c, i) => {
    const name = sessionAt(c.t, tz);
    const gap = i > 0 && c.t - cs[i - 1].t > 3 * 3600;
    if (!name) {
      cur = null;
      return;
    }
    if (!cur || cur.name !== name || gap) {
      cur = { name, firstI: i, lastI: i, high: c.h, low: c.l, highI: i, lowI: i, complete: true };
      out.push(cur);
    }
    cur.lastI = i;
    if (c.h > cur.high) { cur.high = c.h; cur.highI = i; }
    if (c.l < cur.low) { cur.low = c.l; cur.lowI = i; }
  });
  const lastI = cs.length - 1;
  if (out.length && out[out.length - 1].lastI === lastI && sessionAt(cs[lastI].t, tz)) out[out.length - 1].complete = false;
  return out;
}

/** Previous trading day's high/low. Gold's day rolls at 17:00 New York. */
export function prevDay(cs: Candle[], tz = TZ): { high: number; low: number } | null {
  const key = (t: number) => nyParts(t + 7 * 3600, tz).date;
  const days: string[] = [];
  const hl = new Map<string, { high: number; low: number }>();
  for (const c of cs) {
    const k = key(c.t);
    const d = hl.get(k);
    if (!d) { hl.set(k, { high: c.h, low: c.l }); days.push(k); }
    else { d.high = Math.max(d.high, c.h); d.low = Math.min(d.low, c.l); }
  }
  return days.length >= 2 ? hl.get(days[days.length - 2])! : null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function analyseLiquidity(all: Candle[], opts: { tz?: string; now?: number; swingLookback?: number } = {}): LiquidityResult | null {
  const tz = opts.tz ?? TZ;
  // Drop the forming bar: the last bar is closed only if 5 minutes have passed since it opened.
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const cs = all.length && now - all[all.length - 1].t < 300 ? all.slice(0, -1) : all;
  if (cs.length < 30) return null;
  const last = cs[cs.length - 1];
  const a = atr(cs, 14).at(-1) ?? 0;
  const buffer = Math.max(a * 0.25, last.c * 0.0002);
  const boxes = sessionBoxes(cs, tz);
  const current = sessionAt(last.t, tz);
  const pd = prevDay(cs, tz);

  // The box we sweep: the latest COMPLETE session before the current one.
  const done = boxes.filter((b) => b.complete);
  const prev = current ? done.filter((b) => b.lastI < cs.length - 1).at(-1) ?? null : done.at(-1) ?? null;
  const base = { current, prev, sessions: boxes, pdh: pd?.high ?? null, pdl: pd?.low ?? null, last, atr: a };
  if (!prev) {
    return { ...base, stage: "no-data", headline: "Not enough session history yet", action: "Wait for a full session to form.", steps: [], sweep: null, mss: null, plan: null };
  }

  const from = prev.lastI + 1;
  const win = cs.slice(from);
  const hiI = win.findIndex((c) => c.h > prev.high);
  const loI = win.findIndex((c) => c.l < prev.low);
  const range = `${r2(prev.low)}–${r2(prev.high)}`;
  const where = current ? `${current} session` : "between sessions";

  if (hiI < 0 && loI < 0) {
    return {
      ...base, stage: "waiting", sweep: null, mss: null, plan: null,
      headline: `Inside the ${prev.name} range (${range})`,
      action: `No trade yet. Wait for price to run above ${r2(prev.high)} or below ${r2(prev.low)} and fail. Don't trade the middle of the range.`,
      steps: [
        { label: `Sweep ${prev.name} high or low`, done: false, detail: `high ${r2(prev.high)} · low ${r2(prev.low)}` },
        { label: "Close back inside", done: false, detail: "—" },
        { label: "Structure shift", done: false, detail: "—" },
        { label: "Retest entry", done: false, detail: "—" },
      ],
    };
  }
  if (hiI >= 0 && loI >= 0) {
    return {
      ...base, stage: "both", sweep: null, mss: null, plan: null,
      headline: `Both sides of the ${prev.name} range taken`,
      action: "Stand aside. Both pools of liquidity are gone, so there is no clean sweep to fade. Wait for the next session to set a new range.",
      steps: [],
    };
  }

  const side: "high" | "low" = hiI >= 0 ? "high" : "low";
  const sI = from + (side === "high" ? hiI : loI);
  let extI = sI;
  for (let i = sI; i < cs.length; i++) {
    if (side === "high" ? cs[i].h > cs[extI].h : cs[i].l < cs[extI].l) extI = i;
  }
  const extreme = side === "high" ? cs[extI].h : cs[extI].l;
  const level = side === "high" ? prev.high : prev.low;
  const reclaimI = cs.findIndex((c, i) => i >= extI && (side === "high" ? c.c < level : c.c > level));
  const look = opts.swingLookback ?? 6;
  const pre = cs.slice(Math.max(0, extI - look), extI);
  const mssLevel = pre.length ? (side === "high" ? Math.min(...pre.map((c) => c.l)) : Math.max(...pre.map((c) => c.h))) : level;
  const mssI = cs.findIndex((c, i) => i > extI && (side === "high" ? c.c < mssLevel : c.c > mssLevel));
  const sweep = { side, i: sI, extreme, extremeI: extI };
  const mss = { level: mssLevel, i: mssI < 0 ? null : mssI };
  const dir = side === "high" ? "short" : "long";
  const steps = [
    { label: `Swept ${prev.name} ${side}`, done: true, detail: `${r2(level)} taken, extreme ${r2(extreme)}` },
    { label: "Closed back inside", done: reclaimI >= 0, detail: reclaimI >= 0 ? `5m close ${side === "high" ? "below" : "above"} ${r2(level)}` : `needs a 5m close ${side === "high" ? "below" : "above"} ${r2(level)}` },
    { label: "Structure shift", done: mssI >= 0, detail: `5m close ${side === "high" ? "below" : "above"} swing ${r2(mssLevel)}` },
    { label: "Retest entry", done: false, detail: `limit at ${r2(mssLevel)}` },
  ];

  if (reclaimI < 0) {
    return {
      ...base, stage: "swept", sweep, mss, plan: null, steps,
      headline: `${prev.name} ${side} swept — not reclaimed yet`,
      action: `Price is holding ${side === "high" ? "above" : "below"} ${r2(level)}. Right now that is a breakout, not a sweep. No ${dir} until a 5-minute candle closes back ${side === "high" ? "below" : "above"} ${r2(level)}. Don't chase the breakout either.`,
    };
  }
  if (mssI < 0) {
    return {
      ...base, stage: "reclaimed", sweep, mss, plan: null, steps,
      headline: `Sweep of the ${prev.name} ${side} reclaimed — waiting for the shift`,
      action: `Half the setup is there. Wait for a 5-minute close ${side === "high" ? "below" : "above"} ${r2(mssLevel)} (the last swing). Entry comes on the retest after that, not before.`,
    };
  }

  const entry = mssLevel;
  const stop = side === "high" ? extreme + buffer : extreme - buffer;
  const risk = Math.abs(entry - stop);
  const tp1 = side === "high" ? entry - 2 * risk : entry + 2 * risk;
  const tp2 = side === "high" ? prev.low : prev.high;
  const rrTp2 = Math.abs(tp2 - entry) / risk;
  const plan: LiquidityPlan = { side: dir, entry: r2(entry), stop: r2(stop), tp1: r2(tp1), tp2: r2(tp2), risk: r2(risk), rrTp2: Math.round(rrTp2 * 10) / 10 };
  const after = cs.slice(mssI + 1);
  const hitStop = after.some((c) => (dir === "short" ? c.h >= stop : c.l <= stop));
  const filled = after.some((c) => (dir === "short" ? c.h >= entry : c.l <= entry));
  const hitTp1 = after.some((c) => (dir === "short" ? c.l <= tp1 : c.h >= tp1));
  steps[3].done = filled;

  if (hitStop) {
    return { ...base, stage: "invalidated", sweep, mss, plan, steps, headline: "Setup failed — stop level traded", action: `Price went back through ${r2(stop)}. The sweep idea is dead for this session. No re-entry; wait for the next session's range.` };
  }
  if (hitTp1 || (!filled && (dir === "short" ? last.c <= tp1 : last.c >= tp1))) {
    return { ...base, stage: "done", sweep, mss, plan, steps, headline: "Move already played out", action: `Price reached TP1 (${r2(tp1)}). ${filled ? "If you are in: bank part, stop to breakeven, trail toward TP2." : "Missed it — do not chase. Wait for the next session."}` };
  }
  const poor = rrTp2 < 1.5;
  return {
    ...base, stage: filled ? "triggered" : "ready", sweep, mss, plan, steps,
    headline: `${dir === "short" ? "SHORT" : "LONG"} setup · ${prev.name} ${side} sweep (${where})`,
    action: filled
      ? `Entry ${r2(entry)} has traded. Stop ${r2(stop)}. Take half at TP1 ${r2(tp1)}, move the stop to entry, hold the rest for ${r2(tp2)}.`
      : `Place a ${dir === "short" ? "sell" : "buy"} limit at ${r2(entry)}, stop ${r2(stop)} (${r2(risk)} risk), TP1 ${r2(tp1)} (1:2), TP2 ${r2(tp2)}.${poor ? ` Warning: the opposite side of the range is only ${plan.rrTp2}R away — take TP1 only.` : ""} Cancel the order if it hasn't filled by the end of the ${current ?? "next"} session.`,
  };
}

/** Seconds to add to a UTC timestamp to get New York wall-clock time (for chart axes). */
export function tzOffset(t: number, tz = TZ): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t * 1000) / 1000;
}

/** Crude keyword lean of a headline for gold. It reads words, not meaning — a hint, never a signal. */
export function headlineLean(title: string): "bullish" | "bearish" | null {
  const s = title.toLowerCase();
  const bull = /(rate cut|cuts rates|safe[- ]haven|record high|all-time high|weaker dollar|dollar (falls|slips|weakens|drops)|dovish|geopolitic|tension|war|rall(y|ies)|surge|jumps|climbs|gains|rises|soars)/;
  const bear = /(rate hike|hawkish|stronger dollar|dollar (rises|gains|firms|strengthens|jumps)|yields? (rise|climb|jump)|profit[- ]taking|slump|falls|drops|slides|tumbles|retreats|declines|sell-?off)/;
  const b = bull.test(s), r = bear.test(s);
  return b && !r ? "bullish" : r && !b ? "bearish" : null;
}

/** Close of the previous gold trading day (the day rolls at 17:00 New York). */
export function prevDayClose(cs: Candle[], tz = TZ): number | null {
  if (!cs.length) return null;
  const key = (t: number) => nyParts(t + 7 * 3600, tz).date;
  const today = key(cs[cs.length - 1].t);
  for (let i = cs.length - 1; i >= 0; i--) if (key(cs[i].t) !== today) return cs[i].c;
  return null;
}
