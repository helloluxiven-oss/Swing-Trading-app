// Live alerts for your favourites (web push).
//
// Supabase's scheduler calls /api/alerts/run every minute with a secret only
// the database knows. This module asks the database (with that secret) for
// who wants alerts, their devices and favourites, runs the SAME strategy code
// the screens use, and pushes anything new:
//   · a NY sweep of a liquidity pool (XAU / forex / crypto) at or above your grade
//   · a sweep that turned into a ready setup (entry, stop, targets)
//   · a favourite stock whose swing setup became ready / confirmed
// Every alert is logged in the database first, so nothing is ever sent twice.

import "server-only";
import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { candles } from "./feeds";
import { analyseLiquidity, nyDesk } from "./liquidity";
import { INSTRUMENTS, fmtPrice, type Instrument } from "./instruments";
import { analyseOne } from "./scan";
import { resolveStock } from "./stocks";
import { STATUS_LABEL } from "./setup";

const APP = "https://swing-trading-app-seven.vercel.app";
const RECENT = 1800; // only alert on things from the last 30 minutes

export type AlertPrefs = {
  enabled: boolean;
  sweeps: boolean;
  setups: boolean;
  stocks: boolean;
  min_grade: "A" | "B" | "C";
  weekend_crypto: boolean;
  quiet_start: string;
  quiet_end: string;
};
export const DEFAULT_PREFS: AlertPrefs = { enabled: true, sweeps: true, setups: true, stocks: true, min_grade: "B", weekend_crypto: false, quiet_start: "23:00", quiet_end: "07:00" };

type Fav = { symbol: string; market: "IN" | "US" | "FX" | "CRYPTO" };
type Sub = { endpoint: string; p256dh: string; auth: string };
export type Alert = { key: string; title: string; body: string; url: string };

const gradeOk = (g: string, min: string) => "ABC".indexOf(g) <= "ABC".indexOf(min);

function local(tz: string, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { min: (+p.hour % 24) * 60 + +p.minute, weekday: p.weekday as string };
}

export function inQuietHours(tz: string, start: string, end: string, now = new Date()) {
  const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const m = local(tz, now).min, a = toMin(start), b = toMin(end);
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

const isWeekendUtc = (now = new Date()) => ["Sat", "Sun"].includes(local("UTC", now).weekday);

async function deskAlerts(inst: Instrument, p: AlertPrefs, now: number): Promise<Alert[]> {
  if (inst.kind === "crypto" && !p.weekend_crypto && isWeekendUtc()) return [];
  const feed = await candles(inst, "5m");
  const cs = feed?.candles;
  if (!cs?.length) return [];
  const url = `${APP}/${inst.kind === "fx" ? "fx" : "crypto"}?s=${inst.id}`;
  const out: Alert[] = [];
  const d = nyDesk(cs, { now, precision: inst.precision });
  for (const e of d?.events ?? []) {
    if (!gradeOk(e.grade, p.min_grade)) continue;
    if (p.sweeps && cs[e.sI].t > now - RECENT) {
      out.push({
        key: `sweep:${inst.id}:${e.id}`,
        title: `${inst.short} · ${e.pools.join(" + ")} swept · grade ${e.grade}`,
        body: `${fmtPrice(inst, e.level)} taken in New York (${e.score}/100). ${e.status === "breakout" ? "Holding beyond — could be a breakout, don't fade it yet." : "Wait for the close back inside and the structure shift."}`,
        url,
      });
    }
    if (p.setups && e.plan && (e.status === "ready" || e.status === "triggered") && e.mssI !== null && cs[e.mssI].t > now - RECENT) {
      const pl = e.plan;
      out.push({
        key: `ready:${inst.id}:${e.id}`,
        title: `${inst.short} ${pl.side.toUpperCase()} setup ready · grade ${e.grade}`,
        body: `${pl.side === "short" ? "Sell" : "Buy"} limit ${fmtPrice(inst, pl.entry)} · stop ${fmtPrice(inst, pl.stop)} · TP1 ${fmtPrice(inst, pl.tp1)} · TP2 ${fmtPrice(inst, pl.tp2)}`,
        url,
      });
    }
  }
  // Outside the NY session the core previous-session sweep can also turn ready.
  if (p.setups && d?.phase !== "live") {
    const r = analyseLiquidity(cs, { now, precision: inst.precision });
    if (r?.plan && r.stage === "ready" && r.mss?.i != null && cs[r.mss.i].t > now - RECENT) {
      out.push({
        key: `ready:${inst.id}:${cs[r.mss.i].t}`,
        title: `${inst.short} ${r.plan.side.toUpperCase()} setup ready · ${r.prev?.name ?? ""} sweep`,
        body: `${r.plan.side === "short" ? "Sell" : "Buy"} limit ${fmtPrice(inst, r.plan.entry)} · stop ${fmtPrice(inst, r.plan.stop)} · TP1 ${fmtPrice(inst, r.plan.tp1)}`,
        url,
      });
    }
  }
  return out;
}

async function stockAlerts(symbol: string, market: "IN" | "US"): Promise<Alert[]> {
  const stock = await resolveStock(symbol, market);
  if (!stock) return [];
  const a = (await analyseOne(stock)).analysis;
  if (!a || (a.best.status !== "ready" && a.best.status !== "confirmed")) return [];
  return [{
    key: `stock:${market}:${symbol}:${a.last.t}:${a.best.status}`,
    title: `${symbol} · ${STATUS_LABEL[a.best.status]} (${a.best.side})`,
    body: "Your swing rules pass on the last daily close. Open it for the plan and the gate.",
    url: `${APP}/stock/${market}/${encodeURIComponent(symbol)}`,
  }];
}

export async function alertsFor(favs: Fav[], p: AlertPrefs, now = Math.floor(Date.now() / 1000)): Promise<Alert[]> {
  const lists = await Promise.all(
    favs.map(async (f) => {
      if (f.market === "FX" || f.market === "CRYPTO") {
        const inst = INSTRUMENTS.find((i) => i.id === f.symbol && i.kind === (f.market === "FX" ? "fx" : "crypto"));
        return inst && (p.sweeps || p.setups) ? deskAlerts(inst, p, now) : [];
      }
      return p.stocks ? stockAlerts(f.symbol, f.market) : [];
    }),
  );
  return lists.flat();
}

const anon = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

type Due = {
  vapid_public: string | null;
  vapid_private: string | null;
  users: { user_id: string; prefs: AlertPrefs; tz: string | null; subs: Sub[]; favs: Fav[] }[];
};

async function push(sb: SupabaseClient, secret: string | null, subs: Sub[], a: Alert) {
  let n = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: a.key }), { TTL: 1800, urgency: "high" });
      n++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if ((code === 404 || code === 410) && secret) await sb.rpc("alerts_drop", { s: secret, ep: s.endpoint });
    }
  }
  return n;
}

/** Called by the scheduler every minute. */
export async function runAlerts(secret: string) {
  const sb = anon();
  const { data, error } = await sb.rpc("alerts_due", { s: secret });
  if (error) return { ok: false, error: error.message };
  const due = data as Due;
  if (!due.vapid_public || !due.vapid_private) return { ok: true, users: 0, sent: 0, note: "push keys not created yet — open Settings once" };
  webpush.setVapidDetails(APP, due.vapid_public, due.vapid_private);
  const favDefault: Fav[] = [{ symbol: "XAUUSD", market: "FX" }, { symbol: "BTC", market: "CRYPTO" }, { symbol: "NVDA", market: "US" }];
  let sent = 0, checked = 0;
  for (const u of due.users) {
    if (!u.subs.length) continue;
    const p = { ...DEFAULT_PREFS, ...u.prefs };
    if (inQuietHours(u.tz ?? "Asia/Kolkata", p.quiet_start, p.quiet_end)) continue;
    checked++;
    for (const a of await alertsFor(u.favs.length ? u.favs : favDefault, p)) {
      const { data: first } = await sb.rpc("alerts_log", { s: secret, uid: u.user_id, k: a.key, t: a.title, b: a.body });
      if (first) sent += await push(sb, secret, u.subs, a);
    }
  }
  return { ok: true, users: checked, sent };
}

/** Make sure push keys exist (owner only). Returns the public key. */
export async function ensurePushKeys(userDb: SupabaseClient): Promise<string | null> {
  const { data } = await userDb.rpc("alerts_owner_keys");
  const k = data as { vapid_public: string | null } | null;
  if (k?.vapid_public) return k.vapid_public;
  const fresh = webpush.generateVAPIDKeys();
  await userDb.rpc("alerts_owner_init", { pub: fresh.publicKey, priv: fresh.privateKey });
  const { data: again } = await userDb.rpc("alerts_owner_keys");
  return (again as { vapid_public: string | null } | null)?.vapid_public ?? null;
}

/** Send a test notification to every device of the signed-in owner. */
export async function sendTest(userDb: SupabaseClient) {
  const { data } = await userDb.rpc("alerts_owner_keys");
  const k = data as { vapid_public: string | null; vapid_private: string | null } | null;
  if (!k?.vapid_public || !k.vapid_private) return { sent: 0, devices: 0, error: "Push keys missing." };
  webpush.setVapidDetails(APP, k.vapid_public, k.vapid_private);
  const { data: subs } = await userDb.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (!subs?.length) return { sent: 0, devices: 0, error: "No device is subscribed yet." };
  const sent = await push(userDb, null, subs as Sub[], { key: `test:${Date.now()}`, title: "SIGMORA · alerts are on ✅", body: "NY sweeps and ready setups for your favourites will arrive here.", url: `${APP}/settings` });
  return { sent, devices: subs.length };
}
