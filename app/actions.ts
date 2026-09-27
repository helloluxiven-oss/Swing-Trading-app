"use server";

// Every write goes through here. Nothing trusts numbers sent by the browser:
// taking a trade re-reads the market, re-runs the setup, re-computes the plan
// and re-runs the gate on the server, at the moment you press the button.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, allowedEmail } from "@/lib/supabase/server";
import { getSettings, recentClosed } from "@/lib/data";
import { analyseOne } from "@/lib/scan";
import { findStock } from "@/lib/universe";
import { deskInstruments, INSTRUMENTS } from "@/lib/instruments";
import { resolveStock, searchStocks } from "@/lib/stocks";
import type { FavMarket } from "@/lib/data";
import { plan, resultR, type Market } from "@/lib/plan";
import { runGate, type Check } from "@/lib/gate";
import type { Side } from "@/lib/setup";

export type FormState = { ok: boolean; message: string; checks?: Check[] } | null;

// ---- auth ------------------------------------------------------------------

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const mode = String(form.get("mode") ?? "signin");
  if (!allowedEmail()) return { ok: false, message: "ALLOWED_EMAIL is not set on the server." };
  if (email !== allowedEmail()) return { ok: false, message: "This app is private." };
  if (password.length < 10) return { ok: false, message: "Use a password of at least 10 characters." };

  const supabase = await db();
  if (mode === "signup") {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Account created. If Supabase asks you to confirm your email, click the link, then sign in." };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  redirect("/");
}

export async function signOut() {
  const supabase = await db();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---- settings --------------------------------------------------------------

export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await db();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Signed out." };
  const n = (k: string) => Number(form.get(k));
  const days = form.getAll("office_days").map(Number).filter((d) => d >= 1 && d <= 7);
  const row = {
    user_id: u.user.id,
    capital_inr: n("capital_inr"),
    capital_usd: n("capital_usd"),
    risk_pct: n("risk_pct"),
    rr: n("rr"),
    stop_mode: String(form.get("stop_mode")),
    fixed_stop_pct: n("fixed_stop_pct"),
    timezone: String(form.get("timezone") || "Asia/Kolkata"),
    office_start: String(form.get("office_start")),
    office_end: String(form.get("office_end")),
    office_days: days,
    max_consecutive_losses: n("max_consecutive_losses"),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("settings").upsert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

// ---- trades ----------------------------------------------------------------

export async function takeTrade(_: FormState, form: FormData): Promise<FormState> {
  const symbol = String(form.get("symbol") ?? "");
  const market = String(form.get("market") ?? "") as Market;
  const side = String(form.get("side") ?? "long") as Side;
  const stock = findStock(symbol, market) ?? (await resolveStock(symbol, market));
  if (!stock || (side !== "long" && side !== "short")) return { ok: false, message: "Unknown stock." };

  const [settings, recent, live] = await Promise.all([getSettings(), recentClosed(), analyseOne(stock)]);
  const a = live.analysis;
  if (!a) return { ok: false, message: "No market data for this stock right now — nothing to plan from." };
  const res = side === "long" ? a.long : a.short;

  const p = plan({
    side,
    market,
    signalHigh: a.last.h,
    signalLow: a.last.l,
    swingLow: a.swingLow,
    swingHigh: a.swingHigh,
    capital: market === "IN" ? settings.capitalInr : settings.capitalUsd,
    riskPct: settings.riskPct,
    stopMode: settings.stopMode,
    fixedStopPct: settings.fixedStopPct,
    atr: a.atr14,
    atrMult: 1,
    rr: settings.rr,
  });

  const emotions = {
    fomo: form.get("fomo") === "yes",
    revenge: form.get("revenge") === "yes",
    fear: form.get("fear") === "yes",
    greed: form.get("greed") === "yes",
  };
  const gate = runGate({
    now: new Date(),
    settings,
    setupStatus: res.status,
    withTrend: res.rules.find((r) => r.id === "trend")?.pass === true,
    emotions,
    recentClosed: recent,
    hasStopAndTarget: p.qty > 0 && p.stop > 0 && p.target > 0,
  });
  if (!gate.allowed) {
    return { ok: false, message: "Blocked by your own rules.", checks: gate.checks };
  }

  const supabase = await db();
  const { error } = await supabase.from("trades").insert({
    symbol,
    market,
    side,
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    qty: p.qty,
    setup_status: res.status,
    checklist: { emotions, rules: res.rules.map((r) => ({ id: r.id, pass: r.pass })), stopMode: settings.stopMode },
    plan_note: String(form.get("note") ?? "").slice(0, 500) || null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/journal");
  redirect("/journal");
}

export async function closeTrade(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id"));
  const exit = Number(form.get("exit_price"));
  if (!(exit > 0)) return { ok: false, message: "Enter the price you exited at." };
  const supabase = await db();
  const { data: t } = await supabase.from("trades").select("side,entry,stop,status").eq("id", id).maybeSingle();
  if (!t || t.status !== "open") return { ok: false, message: "That trade is not open." };
  const { error } = await supabase
    .from("trades")
    .update({
      status: "closed",
      exit_price: exit,
      closed_at: new Date().toISOString(),
      result_r: resultR(t.side, Number(t.entry), Number(t.stop), exit),
      followed_plan: form.get("followed_plan") === "yes",
      lesson: String(form.get("lesson") ?? "").slice(0, 1000) || null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/journal");
  revalidatePath("/");
  return { ok: true, message: "Closed and logged." };
}

export async function cancelTrade(form: FormData) {
  const supabase = await db();
  await supabase.from("trades").update({ status: "cancelled", closed_at: new Date().toISOString() }).eq("id", String(form.get("id"))).eq("status", "open");
  revalidatePath("/journal");
}

// ---- holdings --------------------------------------------------------------

export async function addHolding(_: FormState, form: FormData): Promise<FormState> {
  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
  const market = String(form.get("market") ?? "US") as Market;
  const qty = Number(form.get("qty"));
  const avg = Number(form.get("avg_price"));
  if (!symbol || !(qty > 0) || !(avg > 0)) return { ok: false, message: "Symbol, quantity and average price are required." };
  const supabase = await db();
  const { error } = await supabase.from("holdings").insert({
    symbol,
    market,
    qty,
    avg_price: avg,
    bought_on: (form.get("bought_on") as string) || null,
    sector: (form.get("sector") as string) || null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/portfolio");
  return { ok: true, message: `${symbol} added.` };
}

export async function removeHolding(form: FormData) {
  const supabase = await db();
  await supabase.from("holdings").delete().eq("id", String(form.get("id")));
  revalidatePath("/portfolio");
}

/** One-time import of the open positions from the MyPortfolio sheet. */
export async function importSheetHoldings() {
  const supabase = await db();
  const { count } = await supabase.from("holdings").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return;
  await supabase.from("holdings").insert([
    { symbol: "KO", market: "US", qty: 1, avg_price: 69.01, bought_on: "2025-09-02", sector: "Consumer Staples" },
    { symbol: "MSFT", market: "US", qty: 0.35368045, avg_price: 500.96, bought_on: "2025-09-02", sector: "Technology" },
    { symbol: "NVDA", market: "US", qty: 1, avg_price: 167.57, bought_on: "2025-09-09", sector: "Technology" },
    { symbol: "ADBE", market: "US", qty: 0.52569963, avg_price: 363.4585, bought_on: "2025-09-17", sector: "Technology" },
  ]);
  revalidatePath("/portfolio");
}

// ---- favourites ------------------------------------------------------------

/** Star / unstar a stock. Returns the new state. */
/** The display name for a favourite, or null if it doesn't exist. */
async function favName(symbol: string, market: FavMarket): Promise<string | null> {
  if (market === "FX" || market === "CRYPTO") return deskInstruments(market === "FX" ? "fx" : "crypto").find((i) => i.id === symbol)?.name ?? null;
  if (market !== "IN" && market !== "US") return null;
  return (await resolveStock(symbol, market))?.name ?? null;
}

export async function toggleWatch(symbol: string, market: FavMarket): Promise<boolean> {
  const name = await favName(symbol, market);
  if (!name) return false;
  const supabase = await db();
  const { data } = await supabase.from("watchlist").select("symbol").eq("symbol", symbol).eq("market", market).maybeSingle();
  if (data) {
    await supabase.from("watchlist").delete().eq("symbol", symbol).eq("market", market);
  } else {
    const { data: last } = await supabase.from("watchlist").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    await supabase.from("watchlist").insert({ symbol, market, name, position: (last?.position ?? 0) + 1 });
  }
  revalidatePath("/");
  revalidatePath("/fx");
  revalidatePath("/crypto");
  return !data;
}

// ---- notifications -----------------------------------------------------------

/** Save this device's push subscription (from the browser's PushManager). */
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string): Promise<FormState> {
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, message: "That device subscription looks invalid." };
  const supabase = await db();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Signed out." };
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: sub.endpoint, user_id: u.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device.slice(0, 80) });
  if (error) return { ok: false, message: error.message };
  // Turning a device on also switches alerts on (with the defaults if never set).
  await supabase.from("alert_prefs").upsert({ user_id: u.user.id, enabled: true }, { onConflict: "user_id" });
  revalidatePath("/settings");
  return { ok: true, message: "This device will get alerts." };
}

export async function removePushSubscription(endpoint: string) {
  const supabase = await db();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  revalidatePath("/settings");
}

export async function saveAlertPrefs(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await db();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Signed out." };
  const hm = (k: string, d: string) => (/^\d{2}:\d{2}$/.test(String(form.get(k))) ? String(form.get(k)) : d);
  const grade = String(form.get("min_grade"));
  const { error } = await supabase.from("alert_prefs").upsert({
    user_id: u.user.id,
    enabled: form.get("enabled") === "on",
    sweeps: form.get("sweeps") === "on",
    setups: form.get("setups") === "on",
    stocks: form.get("stocks") === "on",
    weekend_crypto: form.get("weekend_crypto") === "on",
    min_grade: ["A", "B", "C"].includes(grade) ? grade : "B",
    quiet_start: hm("quiet_start", "23:00"),
    quiet_end: hm("quiet_end", "07:00"),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Alert settings saved." };
}

export async function sendTestAlert(): Promise<FormState> {
  const { sendTest } = await import("@/lib/alerts");
  const r = await sendTest(await db());
  return r.sent ? { ok: true, message: `Sent to ${r.sent} of ${r.devices} device${r.devices > 1 ? "s" : ""}. Check your notifications.` } : { ok: false, message: r.error ?? "Nothing was delivered." };
}

// ---- account -------------------------------------------------------------------

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (next.length < 10) return { ok: false, message: "Use at least 10 characters for the new password." };
  if (next !== confirm) return { ok: false, message: "The two new passwords don't match." };
  if (next === current) return { ok: false, message: "The new password is the same as the current one." };
  const supabase = await db();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user?.email) return { ok: false, message: "Signed out." };
  // Prove it's you before changing it.
  const { error: wrong } = await supabase.auth.signInWithPassword({ email: u.user.email, password: current });
  if (wrong) return { ok: false, message: "Your current password is not right." };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Password changed. Other devices keep working until they sign out." };
}

export async function signOutEverywhere() {
  const supabase = await db();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

export type SearchHit = { symbol: string; name: string; market: FavMarket; kind: string };

/** Search stocks (NSE / US), forex & commodities and crypto for the favourites manager. */
export async function searchMarkets(q: string): Promise<SearchHit[]> {
  const query = q.trim().toUpperCase();
  if (!query) return [];
  const desk: SearchHit[] = INSTRUMENTS.filter((i) => i.id.includes(query) || i.short.toUpperCase().includes(query) || i.name.toUpperCase().includes(query)).map((i) => ({
    symbol: i.id, name: i.name, market: i.kind === "fx" ? "FX" : "CRYPTO", kind: i.kind === "fx" ? i.group : "Crypto",
  }));
  const stocks = (await searchStocks(q)).map((s) => ({ symbol: s.symbol, name: s.name, market: s.market, kind: s.exchange }));
  // A bare ticker typed exactly is offered even if search missed it (validated on add).
  const exact: SearchHit[] = /^[A-Z0-9&.\-]{1,15}$/.test(query) && !stocks.some((s) => s.symbol === query)
    ? [{ symbol: query, name: `${query} (NSE ticker)`, market: "IN", kind: "NSE" }, { symbol: query, name: `${query} (US ticker)`, market: "US", kind: "US" }]
    : [];
  return [...desk, ...stocks, ...exact].slice(0, 16);
}

export async function addFavourite(symbol: string, market: FavMarket): Promise<FormState> {
  const name = await favName(symbol.toUpperCase(), market);
  if (!name) return { ok: false, message: `${symbol.toUpperCase()} wasn't found — no prices for it on ${market === "IN" ? "NSE" : market}.` };
  const supabase = await db();
  const { data: exists } = await supabase.from("watchlist").select("symbol").eq("symbol", symbol.toUpperCase()).eq("market", market).maybeSingle();
  if (exists) return { ok: true, message: "Already in your favourites." };
  const { data: last } = await supabase.from("watchlist").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("watchlist").insert({ symbol: symbol.toUpperCase(), market, name, position: (last?.position ?? 0) + 1 });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  revalidatePath("/favourites");
  return { ok: true, message: `${name} added.` };
}

export async function removeFavourite(symbol: string, market: FavMarket) {
  const supabase = await db();
  await supabase.from("watchlist").delete().eq("symbol", symbol).eq("market", market);
  revalidatePath("/");
  revalidatePath("/favourites");
}

/** Move a favourite up or down (the first three are the dashboard charts). */
export async function moveFavourite(symbol: string, market: FavMarket, dir: -1 | 1) {
  const supabase = await db();
  const { data } = await supabase.from("watchlist").select("symbol,market").order("position").order("created_at");
  const list = data ?? [];
  const i = list.findIndex((w) => w.symbol === symbol && w.market === market);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(list.map((w, k) => supabase.from("watchlist").update({ position: k + 1 }).eq("symbol", w.symbol).eq("market", w.market)));
  revalidatePath("/");
  revalidatePath("/favourites");
}

/** Replace the starter list with real favourites the first time you edit them. */
export async function adoptStarterFavourites() {
  const supabase = await db();
  const { count } = await supabase.from("watchlist").select("symbol", { count: "exact", head: true });
  if ((count ?? 0) > 0) return;
  await supabase.from("watchlist").insert([
    { symbol: "XAUUSD", market: "FX", name: "Gold", position: 1 },
    { symbol: "BTC", market: "CRYPTO", name: "Bitcoin", position: 2 },
    { symbol: "NVDA", market: "US", name: "NVIDIA Corporation", position: 3 },
  ]);
  revalidatePath("/");
  revalidatePath("/favourites");
}
