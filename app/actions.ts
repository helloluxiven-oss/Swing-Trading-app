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
  const stock = findStock(symbol, market);
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
export async function toggleWatch(symbol: string, market: Market): Promise<boolean> {
  if (!findStock(symbol, market)) return false;
  const supabase = await db();
  const { data } = await supabase.from("watchlist").select("symbol").eq("symbol", symbol).eq("market", market).maybeSingle();
  if (data) {
    await supabase.from("watchlist").delete().eq("symbol", symbol).eq("market", market);
  } else {
    await supabase.from("watchlist").insert({ symbol, market });
  }
  revalidatePath("/");
  return !data;
}
