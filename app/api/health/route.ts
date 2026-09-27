// Public health check: can the server reach the market-data source and the
// database? Returns index quotes only — public market data, nothing personal.

import { NextResponse } from "next/server";
import { getSeries } from "@/lib/market";
import { SUPABASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  const [nifty, spx, reliance, nvda] = await Promise.all([
    getSeries("^NSEI", "IN", 30),
    getSeries("^GSPC", "US", 30),
    getSeries("RELIANCE", "IN", 30),
    getSeries("NVDA", "US", 30),
  ]);
  let db = "unknown";
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { cache: "no-store" });
    db = r.ok ? "ok" : `http ${r.status}`;
  } catch {
    db = "unreachable";
  }
  const q = (s: Awaited<ReturnType<typeof getSeries>>) =>
    s ? { price: s.quote.price, changePct: Number(s.quote.changePct.toFixed(2)), quoteTime: new Date(s.quote.time * 1000).toISOString(), marketOpen: s.quote.marketOpen, dailyCandles: s.candles.length } : null;
  const body = {
    ok: !!(nifty && spx && reliance && nvda) && db === "ok",
    market: { nifty50: q(nifty), sp500: q(spx), reliance: q(reliance), nvda: q(nvda) },
    database: db,
    ms: Date.now() - t0,
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
