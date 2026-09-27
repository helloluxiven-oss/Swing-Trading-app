// Any stock, not just the built-in universe: look it up, and search by name.
// Server-only. A ticker is accepted only if the data source returns prices for it.

import "server-only";
import { findStock, yahooSymbol, type Stock } from "./universe";
import type { Market } from "./plan";

const CLEAN = /^[A-Z0-9&.\-]{1,20}$/;

/** Resolve a ticker in a market to a Stock, or null if no prices exist for it. */
export async function resolveStock(symbol: string, market: Market): Promise<Stock | null> {
  const s = decodeURIComponent(symbol).trim().toUpperCase();
  if (!CLEAN.test(s)) return null;
  const known = findStock(s, market);
  if (known) return known;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(s, market))}?range=5d&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const j = (await r.json()) as { chart: { result?: { meta: { longName?: string; shortName?: string; instrumentType?: string; regularMarketPrice?: number } }[] } };
    const m = j.chart.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return null;
    if (m.instrumentType && !["EQUITY", "ETF"].includes(m.instrumentType)) return null;
    return { symbol: s, name: m.longName ?? m.shortName ?? s, market };
  } catch {
    return null;
  }
}

export type Found = { symbol: string; name: string; market: Market; exchange: string };

const US_EXCH = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS", "NYS"]);

/** Search stocks by ticker or company name across NSE and US exchanges. */
export async function searchStocks(q: string): Promise<Found[]> {
  const query = q.trim();
  if (query.length < 1 || query.length > 40) return [];
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } });
    if (!r.ok) return [];
    const j = (await r.json()) as { quotes?: { symbol: string; shortname?: string; longname?: string; exchange?: string; quoteType?: string }[] };
    const out: Found[] = [];
    for (const x of j.quotes ?? []) {
      if (x.quoteType !== "EQUITY" && x.quoteType !== "ETF") continue;
      const name = x.longname ?? x.shortname ?? x.symbol;
      if (x.symbol.endsWith(".NS")) out.push({ symbol: x.symbol.slice(0, -3), name, market: "IN", exchange: "NSE" });
      else if (!x.symbol.includes(".") && US_EXCH.has(x.exchange ?? "")) out.push({ symbol: x.symbol, name, market: "US", exchange: x.exchange === "NYQ" || x.exchange === "NYS" ? "NYSE" : "NASDAQ" });
    }
    return out.slice(0, 10);
  } catch {
    return [];
  }
}
