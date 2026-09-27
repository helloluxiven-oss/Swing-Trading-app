import "server-only";
import { db } from "./supabase/server";
import type { Settings as GateSettings } from "./gate";
import type { Market, StopMode } from "./plan";
import type { Side } from "./setup";

export type AppSettings = GateSettings & {
  capitalInr: number;
  capitalUsd: number;
  riskPct: number;
  rr: number;
  stopMode: StopMode;
  fixedStopPct: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  capitalInr: 100000,
  capitalUsd: 1000,
  riskPct: 1,
  rr: 2,
  stopMode: "smart",
  fixedStopPct: 2,
  timezone: "Asia/Kolkata",
  officeStart: "09:30",
  officeEnd: "18:00",
  officeDays: [1, 2, 3, 4, 5],
  maxConsecutiveLosses: 2,
};

export type Trade = {
  id: string;
  symbol: string;
  market: Market;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  setup_status: string;
  checklist: Record<string, unknown>;
  plan_note: string | null;
  status: "open" | "closed" | "cancelled";
  created_at: string;
  exit_price: number | null;
  closed_at: string | null;
  result_r: number | null;
  followed_plan: boolean | null;
  lesson: string | null;
};

export type Holding = {
  id: string;
  symbol: string;
  market: Market;
  qty: number;
  avg_price: number;
  bought_on: string | null;
  sector: string | null;
};

const num = (x: unknown) => (x === null || x === undefined ? x : Number(x));

export async function currentUser() {
  const supabase = await db();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function getSettings(): Promise<AppSettings> {
  const supabase = await db();
  const { data } = await supabase.from("settings").select("*").maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    capitalInr: Number(data.capital_inr),
    capitalUsd: Number(data.capital_usd),
    riskPct: Number(data.risk_pct),
    rr: Number(data.rr),
    stopMode: data.stop_mode,
    fixedStopPct: Number(data.fixed_stop_pct),
    timezone: data.timezone,
    officeStart: data.office_start,
    officeEnd: data.office_end,
    officeDays: data.office_days,
    maxConsecutiveLosses: data.max_consecutive_losses,
  };
}

function toTrade(r: Record<string, unknown>): Trade {
  return {
    ...(r as unknown as Trade),
    entry: Number(r.entry),
    stop: Number(r.stop),
    target: Number(r.target),
    qty: Number(r.qty),
    exit_price: num(r.exit_price) as number | null,
    result_r: num(r.result_r) as number | null,
  };
}

export async function getTrades(): Promise<Trade[]> {
  const supabase = await db();
  const { data } = await supabase.from("trades").select("*").order("created_at", { ascending: false }).limit(500);
  return (data ?? []).map(toTrade);
}

export async function recentClosed(limit = 20) {
  const supabase = await db();
  const { data } = await supabase
    .from("trades")
    .select("closed_at,result_r")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({ closedAt: r.closed_at as string, resultR: Number(r.result_r) }));
}

export async function getHoldings(): Promise<Holding[]> {
  const supabase = await db();
  const { data } = await supabase.from("holdings").select("*").order("created_at");
  return (data ?? []).map((r) => ({ ...(r as Holding), qty: Number(r.qty), avg_price: Number(r.avg_price) }));
}

/** Favourite markets: stocks (IN/US), forex & commodities (FX), crypto (CRYPTO). */
export type FavMarket = Market | "FX" | "CRYPTO";
export type Watch = { symbol: string; market: FavMarket };

export async function getWatchlist(): Promise<Watch[]> {
  const supabase = await db();
  const { data } = await supabase.from("watchlist").select("symbol,market").order("created_at");
  return (data ?? []) as Watch[];
}
