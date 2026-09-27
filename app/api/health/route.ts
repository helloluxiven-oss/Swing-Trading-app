// Public health check: can the server reach the market-data source and the
// database? Returns index quotes only — public market data, nothing personal.

import { NextResponse } from "next/server";
import { getSeries } from "@/lib/market";
import { goldCandles, goldChart, goldNews, usdEvents } from "@/lib/gold";
import { stockIntraday } from "@/lib/market";
import { candles as feed } from "@/lib/feeds";
import { findInstrument } from "@/lib/instruments";
import { derivDiag, fiiDii, getChain } from "@/lib/derivs";
import { todayCall } from "@/lib/fnocall";
import { resolveStock, searchStocks } from "@/lib/stocks";
import { analyseLiquidity } from "@/lib/liquidity";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t0 = Date.now();
  const [g1m, g4h, nvda1h, rel4h, rel5m] = await Promise.all([goldChart("1m"), goldChart("4h"), stockIntraday("NVDA", "US", "1h"), stockIntraday("RELIANCE", "IN", "4h"), stockIntraday("RELIANCE", "IN", "5m")]);
  const [btc, eurusd, bnb] = await Promise.all([feed(findInstrument("crypto", "BTC")), feed(findInstrument("fx", "EURUSD")), feed(findInstrument("crypto", "BNB"))]);
  const [cNifty, cSensex, cBtc, flows] = await Promise.all([getChain("NIFTY"), getChain("SENSEX"), getChain("BTC"), fiiDii()]);
  const ch = (c: Awaited<ReturnType<typeof getChain>>) => (c ? { spot: c.spot, strikes: c.rows.length, expiries: c.expiries.length, futures: c.futures.length, vol: c.volIndex?.value ?? null } : null);
  const fs = (f: Awaited<ReturnType<typeof feed>>) => (f ? { source: f.source, live: f.live, price: f.price, candles5m: f.candles.length } : null);
  const [gold, news, events, nifty, spx, reliance, nvda] = await Promise.all([
    goldCandles(),
    goldNews(3),
    usdEvents(),
    getSeries("^NSEI", "IN", 30),
    getSeries("^GSPC", "US", 30),
    getSeries("RELIANCE", "IN", 30),
    getSeries("NVDA", "US", 30),
  ]);
  let db = "unknown";
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { cache: "no-store", headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    db = r.ok ? "ok" : `http ${r.status}`;
  } catch {
    db = "unreachable";
  }
  const q = (s: Awaited<ReturnType<typeof getSeries>>) =>
    s ? { price: s.quote.price, changePct: Number(s.quote.changePct.toFixed(2)), quoteTime: new Date(s.quote.time * 1000).toISOString(), marketOpen: s.quote.marketOpen, dailyCandles: s.candles.length } : null;
  const body = {
    ok: !!(nifty && spx && reliance && nvda) && db === "ok",
    market: { nifty50: q(nifty), sp500: q(spx), reliance: q(reliance), nvda: q(nvda) },
    gold: gold
      ? { source: gold.source, live: gold.live, price: gold.price, candles5m: gold.candles.length, stage: analyseLiquidity(gold.candles)?.stage ?? null }
      : null,
    calls: new URL(req.url).searchParams.has("calls")
      ? Object.fromEntries(await Promise.all((["NIFTY", "BTC", "ETH"] as const).map(async (u) => {
          const r = await todayCall(u);
          return [u, r.decision ? { action: r.decision.action, score: r.decision.score, confidence: r.decision.confidence, trade: r.decision.trade, factors: r.decision.factors.map((f) => `${f.name} ${f.score.toFixed(1)}: ${f.note}`) } : null];
        })))
      : undefined,
    search: new URL(req.url).searchParams.get("search")
      ? { hits: await searchStocks(new URL(req.url).searchParams.get("search")!), resolveTCS: await resolveStock("TCS", "IN"), resolveZOMATO: await resolveStock("ETERNAL", "IN"), resolvePLTR: await resolveStock("PLTR", "US") }
      : undefined,
    fno: { nifty: ch(cNifty), sensex: ch(cSensex), btc: ch(cBtc), fiiDii: flows, diag: new URL(req.url).searchParams.has("diag") ? await derivDiag() : undefined },
    desks: { btc: fs(btc), eurusd: fs(eurusd), bnb: fs(bnb) },
    timeframes: { gold1m: g1m?.candles.length ?? 0, gold4h: g4h?.candles.length ?? 0, nvda1h: nvda1h?.length ?? 0, reliance4h: rel4h?.length ?? 0, reliance5m: rel5m?.length ?? 0 },
    news: news.length,
    usdEvents: events.length,
    database: db,
    ms: Date.now() - t0,
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
