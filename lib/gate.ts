// The discipline gate. Every check here comes from a line in the Day Trading
// Journal, and every block quotes the journal back, because the lesson was
// already written down — it just was not enforced.
//
// A trade is allowed only when every check passes. There is no override.

import type { Status } from "./setup";

export type Settings = {
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  officeStart: string; // "HH:MM"
  officeEnd: string; // "HH:MM"
  officeDays: number[]; // 1 = Monday … 7 = Sunday
  maxConsecutiveLosses: number;
};

export type Emotions = {
  fomo: boolean;
  revenge: boolean;
  fear: boolean;
  greed: boolean;
};

export type RecentTrade = { closedAt: string; resultR: number };

export type Check = { id: string; label: string; pass: boolean; why: string };

export type GateInput = {
  now: Date;
  settings: Settings;
  setupStatus: Status;
  withTrend: boolean;
  emotions: Emotions;
  recentClosed: RecentTrade[]; // most recent first
  hasStopAndTarget: boolean;
};

/** Wall-clock parts of `d` in `tz`: weekday 1–7 (Mon–Sun), minutes since midnight, and a date key. */
export function localParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  const hour = Number(get("hour")) % 24;
  return {
    weekday: wd,
    minutes: hour * 60 + Number(get("minute")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function inOfficeHours(now: Date, s: Settings): boolean {
  const { weekday, minutes } = localParts(now, s.timezone);
  if (!s.officeDays.includes(weekday)) return false;
  const a = toMin(s.officeStart);
  const b = toMin(s.officeEnd);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b; // overnight shifts
}

/** Losses in a row at the top of the list, and whether the latest one closed today. */
export function lossStreak(recent: RecentTrade[], now: Date, tz: string) {
  let n = 0;
  for (const t of recent) {
    if (t.resultR < 0) n++;
    else break;
  }
  const today = localParts(now, tz).dateKey;
  const lastToday = recent[0] ? localParts(new Date(recent[0].closedAt), tz).dateKey === today : false;
  return { streak: n, lastLossToday: n > 0 && lastToday };
}

export function runGate(g: GateInput): { allowed: boolean; checks: Check[] } {
  const office = inOfficeHours(g.now, g.settings);
  const { streak, lastLossToday } = lossStreak(g.recentClosed, g.now, g.settings.timezone);
  const cooling = streak >= g.settings.maxConsecutiveLosses && lastLossToday;
  const e = g.emotions;
  const felt = [e.fomo && "FOMO", e.revenge && "revenge", e.fear && "fear", e.greed && "greed"].filter(Boolean);

  const checks: Check[] = [
    {
      id: "setup",
      label: "It is my setup",
      pass: g.setupStatus === "ready" || g.setupStatus === "confirmed",
      why: "“If you don't wait for your setup you will lose.” Only a Setup ready or Setup confirmed stock can be traded.",
    },
    {
      id: "trend",
      label: "With the trend",
      pass: g.withTrend,
      why: "“Traded against the trend.” — the reason on both 1st-week and 18-08 losses.",
    },
    {
      id: "office",
      label: "Outside office hours",
      pass: !office,
      why: "“No trading during office hours. Only analysis — plan an entry after 6 PM.”",
    },
    {
      id: "emotions",
      label: "No FOMO, revenge, fear or greed",
      pass: felt.length === 0,
      why: felt.length
        ? `You marked ${felt.join(", ")}. “Mark your entry point before — don't even think to enter otherwise.”`
        : "“Learn to stay neutral.”",
    },
    {
      id: "cooldown",
      label: `Not after ${g.settings.maxConsecutiveLosses} losses in a row today`,
      pass: !cooling,
      why: "“Take a break here. Come back once you mastered the art of patience.”",
    },
    {
      id: "levels",
      label: "Stop-loss and target set before entry",
      pass: g.hasStopAndTarget,
      why: "“Once you have decided your TP and SL, let the trade run — don't change it afterwards.”",
    },
  ];
  return { allowed: checks.every((c) => c.pass), checks };
}
