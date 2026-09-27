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

/** Round to the instrument's price precision (2 for gold/indices, 5 for most FX pairs, 3 for JPY pairs). */
const roundTo = (p: number) => (x: number) => Math.round(x * 10 ** p) / 10 ** p;

export function analyseLiquidity(all: Candle[], opts: { tz?: string; now?: number; swingLookback?: number; precision?: number } = {}): LiquidityResult | null {
  const tz = opts.tz ?? TZ;
  const r2 = roundTo(opts.precision ?? 2);
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

export type SessionLevel = {
  session: SessionName;
  kind: "high" | "low";
  price: number;
  fromI: number; // bar where the level was made — the line starts here
  endI: number; // last bar of that session
  sweptI: number | null; // first later bar that traded through it (liquidity taken)
  live: boolean; // session still running, level can still move
};

/**
 * High and low of every session in the current gold day (Asia → London → New
 * York, rolling at 17:00 New York) plus yesterday's New York session, which is
 * the liquidity Asia trades against. Each level says whether it has been swept.
 */
export function dayLevels(cs: Candle[], tz = TZ): SessionLevel[] {
  if (!cs.length) return [];
  const boxes = sessionBoxes(cs, tz);
  const key = (t: number) => nyParts(t + 7 * 3600, tz).date;
  const today = key(cs[cs.length - 1].t);
  const todays = boxes.filter((b) => key(cs[b.firstI].t) === today);
  const before = boxes.filter((b) => key(cs[b.firstI].t) !== today && b.name === "New York").at(-1);
  const pick = before ? [before, ...todays] : todays;
  const out: SessionLevel[] = [];
  for (const b of pick) {
    for (const kind of ["high", "low"] as const) {
      const price = kind === "high" ? b.high : b.low;
      let sweptI: number | null = null;
      for (let i = b.lastI + 1; i < cs.length; i++) {
        if (kind === "high" ? cs[i].h > price : cs[i].l < price) { sweptI = i; break; }
      }
      out.push({ session: b.name, kind, price, fromI: kind === "high" ? b.highI : b.lowI, endI: b.lastI, sweptI, live: !b.complete });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// New York sweep monitor
//
// During the New York session every untouched pool from earlier in the day is
// a target: London high/low (your "previous session"), Asia high/low and the
// previous day's high/low. The first time NY trades through one, that is an
// event. Each event is followed through the same steps as the core strategy —
// reclaim, structure shift, retest — and graded on things that separate a real
// liquidity grab from a breakout:
//
//   level       London 25 · PDH/PDL 20 · Asia 15
//   confluence  +10 when two pools sit within 0.3 ATR (e.g. London high = Asia high)
//   rejection   reclaimed within 3 bars +20, within 6 bars +10
//   killzone    swept 08:00–10:30 NY +15
//   clean       wick beyond the level ≤ 1.5 ATR +10 (a sweep, not a new trend)
//   volume      sweep bar ≥ 1.5× the 20-bar average +10
//   shift       structure shift confirmed +20
//   news        no red USD release within 30 min +10
//   both sides  −20 when NY has taken the London high AND low (expansion day)
//
// Out of 120, shown as a 0–100 score: A ≥ 75, B ≥ 55, else C.
// ---------------------------------------------------------------------------

export type Pool = { name: string; short: string; kind: "high" | "low"; price: number; weight: number; takenBeforeNY: boolean };

export type SweepEvent = {
  id: string; // stable across refreshes: pool + sweep bar time
  pools: string[];
  kind: "high" | "low";
  level: number;
  sI: number;
  extreme: number;
  extremeI: number;
  reclaimI: number | null;
  mssLevel: number;
  mssI: number | null;
  status: "testing" | "breakout" | "reclaimed" | "ready" | "triggered" | "invalidated" | "done";
  score: number;
  grade: "A" | "B" | "C";
  factors: { label: string; pass: boolean; points: number }[];
  plan: LiquidityPlan | null;
  text: string;
};

export type NyDesk = {
  phase: "pre" | "live" | "after";
  pools: Pool[];
  events: SweepEvent[];
  primary: SweepEvent | null;
  headline: string;
  action: string;
  nyStartI: number | null;
};

const KZ_END = 10 * 60 + 30;

export function nyDesk(all: Candle[], opts: { tz?: string; now?: number; redNews?: number[]; precision?: number } = {}): NyDesk | null {
  const tz = opts.tz ?? TZ;
  const r2 = roundTo(opts.precision ?? 2);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const cs = all.length && now - all[all.length - 1].t < 300 ? all.slice(0, -1) : all;
  if (cs.length < 30) return null;
  const a = atr(cs, 14).at(-1) ?? 0;
  const buffer = Math.max(a * 0.25, cs[cs.length - 1].c * 0.0002);
  const key = (t: number) => nyParts(t + 7 * 3600, tz).date;
  const today = key(cs[cs.length - 1].t);
  const boxes = sessionBoxes(cs, tz).filter((b) => key(cs[b.firstI].t) === today);
  const ny = boxes.find((b) => b.name === "New York") ?? null;
  const lastMin = nyParts(cs[cs.length - 1].t, tz).minutes;
  const phase: NyDesk["phase"] = ny ? (ny.complete ? "after" : "live") : lastMin >= 12 * 60 && lastMin < 20 * 60 ? "after" : "pre";
  const nyStartI = ny?.firstI ?? null;
  const cut = nyStartI ?? cs.length; // pools must be untouched before NY opens

  const pd = prevDay(cs, tz);
  const raw: Omit<Pool, "takenBeforeNY">[] = [];
  for (const b of boxes) {
    if (b.name === "New York") continue;
    const w = b.name === "London" ? 25 : 15;
    const s = b.name === "London" ? "LO" : "AS";
    raw.push({ name: `${b.name} high`, short: `${s} H`, kind: "high", price: b.high, weight: w });
    raw.push({ name: `${b.name} low`, short: `${s} L`, kind: "low", price: b.low, weight: w });
  }
  if (pd) {
    raw.push({ name: "Prev day high", short: "PDH", kind: "high", price: pd.high, weight: 20 });
    raw.push({ name: "Prev day low", short: "PDL", kind: "low", price: pd.low, weight: 20 });
  }
  // A pool made by a session and later traded through before NY is already spent.
  const madeAt = (p: Omit<Pool, "takenBeforeNY">) => {
    const b = boxes.find((x) => p.name.startsWith(x.name));
    return b ? b.lastI + 1 : 0;
  };
  const pools: Pool[] = raw.map((p) => {
    let taken = false;
    for (let i = madeAt(p); i < cut; i++) if (p.kind === "high" ? cs[i].h > p.price : cs[i].l < p.price) { taken = true; break; }
    return { ...p, takenBeforeNY: taken };
  });
  const resting = pools.filter((p) => !p.takenBeforeNY);

  const events: SweepEvent[] = [];
  if (ny) {
    const vol = cs.map((c) => c.v);
    const hasVol = vol.some((v) => v > 0);
    const used = new Set<string>();
    for (const p of resting.sort((x, y) => (x.kind === "high" ? x.price - y.price : y.price - x.price))) {
      if (used.has(p.name)) continue;
      let sI = -1;
      for (let i = ny.firstI; i < cs.length; i++) if (p.kind === "high" ? cs[i].h > p.price : cs[i].l < p.price) { sI = i; break; }
      if (sI < 0) continue;
      // Pools taken by the same move within 0.3 ATR are one event.
      const group = resting.filter((q) => q.kind === p.kind && !used.has(q.name) && Math.abs(q.price - p.price) <= a * 0.3);
      group.forEach((q) => used.add(q.name));
      const level = p.kind === "high" ? Math.max(...group.map((q) => q.price)) : Math.min(...group.map((q) => q.price));
      const beyond = (c: Candle) => (p.kind === "high" ? c.c > level : c.c < level);
      const reclaimRel = cs.slice(sI).findIndex((c) => !beyond(c));
      const reclaimI = reclaimRel < 0 ? null : sI + reclaimRel;
      let extI = sI;
      const extEnd = reclaimI === null ? cs.length - 1 : Math.max(reclaimI, sI);
      for (let i = sI; i <= extEnd; i++) if (p.kind === "high" ? cs[i].h > cs[extI].h : cs[i].l < cs[extI].l) extI = i;
      const extreme = p.kind === "high" ? cs[extI].h : cs[extI].l;
      const pre = cs.slice(Math.max(0, extI - 6), extI);
      const mssLevel = pre.length ? (p.kind === "high" ? Math.min(...pre.map((c) => c.l)) : Math.max(...pre.map((c) => c.h))) : level;
      const mssRel = reclaimI === null ? -1 : cs.slice(extI + 1).findIndex((c) => (p.kind === "high" ? c.c < mssLevel : c.c > mssLevel));
      const mssI = mssRel < 0 ? null : extI + 1 + mssRel;
      const closesBeyond = cs.slice(sI).filter(beyond).length;

      const minute = nyParts(cs[sI].t, tz).minutes;
      const avg20 = vol.slice(Math.max(0, sI - 20), sI);
      const volRatio = hasVol && avg20.length ? vol[sI] / (avg20.reduce((x, y) => x + y, 0) / avg20.length || 1) : 0;
      const news = (opts.redNews ?? []).some((t) => Math.abs(t - cs[sI].t) <= 1800);
      const factors = [
        { label: `${group.map((q) => q.name).join(" + ")}`, pass: true, points: Math.max(...group.map((q) => q.weight)) },
        { label: "Confluence of two pools", pass: group.length > 1, points: 10 },
        { label: reclaimI !== null && reclaimI - sI <= 3 ? "Fast rejection (≤ 3 bars)" : "Rejection within 6 bars", pass: reclaimI !== null && reclaimI - sI <= 6, points: reclaimI !== null && reclaimI - sI <= 3 ? 20 : 10 },
        { label: "In the NY killzone (08:00–10:30)", pass: minute >= 8 * 60 && minute <= KZ_END, points: 15 },
        { label: "Clean wick (≤ 1.5 ATR beyond)", pass: Math.abs(extreme - level) <= a * 1.5, points: 10 },
        { label: hasVol ? `Volume spike (${volRatio.toFixed(1)}× avg)` : "Volume spike (no volume data)", pass: volRatio >= 1.5, points: 10 },
        { label: "Structure shift confirmed", pass: mssI !== null, points: 20 },
        { label: "No red USD news ±30 min", pass: !news, points: 10 },
      ];
      let raw = factors.reduce((s, f) => s + (f.pass ? f.points : 0), 0);
      const lonH = pools.find((q) => q.name === "London high"), lonL = pools.find((q) => q.name === "London low");
      const bothLondon = !!lonH && !!lonL && cs.slice(ny.firstI).some((c) => c.h > lonH.price) && cs.slice(ny.firstI).some((c) => c.l < lonL.price);
      if (bothLondon) { raw -= 20; factors.push({ label: "NY took both London high and low (expansion)", pass: false, points: -20 }); }
      const score = Math.max(0, Math.min(100, Math.round((raw / 120) * 100)));
      const grade = score >= 75 ? "A" : score >= 55 ? "B" : "C";

      // Plan: same mechanics as the core strategy; TP2 = nearest untouched pool on the other side.
      let plan: LiquidityPlan | null = null;
      let status: SweepEvent["status"] = reclaimI === null ? (closesBeyond >= 3 ? "breakout" : "testing") : mssI === null ? "reclaimed" : "ready";
      if (mssI !== null) {
        const dir = p.kind === "high" ? "short" : "long";
        const entry = mssLevel;
        const stop = p.kind === "high" ? extreme + buffer : extreme - buffer;
        const risk = Math.abs(entry - stop);
        const tp1 = dir === "short" ? entry - 2 * risk : entry + 2 * risk;
        const opp = resting.filter((q) => q.kind !== p.kind && (dir === "short" ? q.price < entry : q.price > entry));
        const tp2 = opp.length ? (dir === "short" ? Math.max(...opp.map((q) => q.price)) : Math.min(...opp.map((q) => q.price))) : tp1;
        plan = { side: dir, entry: r2(entry), stop: r2(stop), tp1: r2(tp1), tp2: r2(tp2), risk: r2(risk), rrTp2: Math.round((Math.abs(tp2 - entry) / risk) * 10) / 10 };
        const after = cs.slice(mssI + 1);
        if (after.some((c) => (dir === "short" ? c.h >= stop : c.l <= stop))) status = "invalidated";
        else if (after.some((c) => (dir === "short" ? c.l <= tp1 : c.h >= tp1))) status = "done";
        else if (after.some((c) => (dir === "short" ? c.h >= entry : c.l <= entry))) status = "triggered";
      }
      const names = group.map((q) => q.short).join("+");
      const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(cs[sI].t * 1000));
      const verb: Record<SweepEvent["status"], string> = {
        testing: "trading beyond — wait for a close back inside",
        breakout: "accepted beyond (3+ closes) — a breakout, not a sweep",
        reclaimed: "reclaimed — wait for the structure shift",
        ready: `${p.kind === "high" ? "SHORT" : "LONG"} setup ready`,
        triggered: "entry filled — manage the trade",
        invalidated: "failed — stop traded",
        done: "played out to TP1",
      };
      events.push({
        id: `${names}@${cs[sI].t}`, pools: group.map((q) => q.name), kind: p.kind, level: r2(level), sI, extreme: r2(extreme), extremeI: extI,
        reclaimI, mssLevel: r2(mssLevel), mssI, status, score, grade, factors, plan,
        text: `${t} NY · ${names} ${r2(level)} swept · ${verb[status]} · grade ${grade}`,
      });
    }
    events.sort((x, y) => x.sI - y.sI);
  }

  const live = events.filter((e) => e.status !== "invalidated" && e.status !== "done" && e.status !== "breakout");
  const primary = live.find((e) => e.status === "ready" || e.status === "triggered") ?? live.at(-1) ?? events.at(-1) ?? null;
  const restingNow = resting.filter((p) => !events.some((e) => e.pools.includes(p.name)));
  const list = (ps: Pool[]) => ps.map((p) => `${p.short} ${r2(p.price)}`).join(", ") || "none";

  let headline: string;
  let action: string;
  if (phase === "pre") {
    headline = "Before New York — mark the pools";
    action = `Liquidity resting for NY: above ${list(restingNow.filter((p) => p.kind === "high"))}; below ${list(restingNow.filter((p) => p.kind === "low"))}. Spent before NY: ${list(pools.filter((p) => p.takenBeforeNY))}. Wait for NY to run one of the resting pools and fail.`;
  } else if (!primary) {
    headline = phase === "live" ? "NY live — no pool swept yet" : "NY closed — no sweep today";
    action = phase === "live" ? `Nothing taken yet. Watch above ${list(restingNow.filter((p) => p.kind === "high"))} and below ${list(restingNow.filter((p) => p.kind === "low"))}.` : "No setup today. Don't force one after the session.";
  } else {
    const e = primary;
    const p = e.plan;
    headline = `${e.pools.join(" + ")} swept · grade ${e.grade} (${e.score}/100)`;
    action =
      e.status === "ready" && p
        ? `${p.side === "short" ? "Sell" : "Buy"} limit ${p.entry}, stop ${p.stop}, TP1 ${p.tp1}, TP2 ${p.tp2} (${p.rrTp2}R).${e.grade === "C" ? " Grade C: skip it or half size." : ""}${phase === "after" ? " NY is over — cancel if unfilled." : ""}`
        : e.status === "triggered" && p
          ? `In the trade from ${p.entry}. Stop ${p.stop}. Half off at ${p.tp1}, stop to entry, rest to ${p.tp2}.`
          : e.status === "reclaimed"
            ? `Closed back inside. Next: a 5m close ${e.kind === "high" ? "below" : "above"} ${e.mssLevel} confirms the shift. No entry before that.`
            : `Price is ${e.kind === "high" ? "above" : "below"} ${e.level}. Wait for a 5m close back ${e.kind === "high" ? "below" : "above"} it — until then it could be a breakout.`;
  }
  return { phase, pools, events, primary, headline, action, nyStartI };
}
