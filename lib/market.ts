// Live market data from Yahoo Finance's public chart endpoint, server-side only.
//
// Delays, stated plainly: US quotes are near real-time; NSE quotes on free
// feeds usually run about 15 minutes behind. The setup uses daily candles, so a
// 15-minute lag does not change any rule — but every screen shows the quote time.
//
// While a market is open, today's candle is still forming. The rules only look at
// COMPLETED daily candles, so a setup cannot flicker in and out during the day;
// the live price is shown separately.

import "server-only";
import type { Candle } from "./indicators";
import type { Market } from "./plan";
import { yahooSymbol } from "./universe";

export type Quote = {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  currency: string;
  time: number; // unix seconds of the last trade
  marketOpen: boolean;
};

export type Series = {
  quote: Quote;
  candles: Candle[]; // completed daily candles only
  forming: Candle | null; // today's candle while the market is open
};

const UA = "Mozilla/5.0 (compatible; swing-trading-app/0.1)";

type YahooChart = {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency: string;
        regularMarketTime: number;
        currentTradingPeriod?: { regular?: { start: number; end: number } };
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

/**
 * Daily candles for ~1 year (or 2) plus the live quote. Cached for `revalidate` seconds
 * so a page full of stocks does not hammer the source.
 */
export async function getSeries(symbol: string, market: Market, revalidate = 300, range: "1y" | "2y" = "1y"): Promise<Series | null> {
  const ys = yahooSymbol(symbol, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=${range}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate } });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooChart;
    const r = data.chart.result?.[0];
    if (!r || !r.timestamp) return null;
    const q = r.indicators.quote[0];
    const all: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
      if (o == null || h == null || l == null || c == null) return;
      all.push({ t, o, h, l, c, v: v ?? 0 });
    });
    if (!all.length) return null;

    const now = Math.floor(Date.now() / 1000);
    const period = r.meta.currentTradingPeriod?.regular;
    const marketOpen = !!period && now >= period.start && now < period.end;
    const lastBar = all[all.length - 1];
    const forming = marketOpen && period && lastBar.t >= period.start - 12 * 3600 ? lastBar : null;
    const candles = forming ? all.slice(0, -1) : all;

    const price = r.meta.regularMarketPrice;
    const prevClose = forming ? candles[candles.length - 1]?.c ?? price : all.length > 1 ? all[all.length - 2].c : price;
    return {
      quote: {
        symbol,
        price,
        prevClose,
        change: price - prevClose,
        changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
        currency: r.meta.currency,
        time: r.meta.regularMarketTime,
        marketOpen,
      },
      candles,
      forming,
    };
  } catch {
    return null;
  }
}

/** Run `fn` over `items` with at most `limit` in flight — polite to the data source. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** USD → INR for showing the US book in rupees. Falls back to null, never to a made-up rate. */
export async function usdInr(): Promise<number | null> {
  const s = await getSeries("USDINR=X", "US", 300);
  return s?.quote.price ?? null;
}

/**
 * Intraday candles (5-minute by default) for the gold desk. Returns every bar,
 * including the one still forming — the caller decides what counts as closed.
 */
export async function getIntraday(yahoo: string, interval = "5m", range = "5d", revalidate = 60): Promise<{ candles: Candle[]; price: number; time: number } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${range}&interval=${interval}&includePrePost=true`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate } });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooChart;
    const r = data.chart.result?.[0];
    if (!r || !r.timestamp) return null;
    const q = r.indicators.quote[0];
    const candles: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      candles.push({ t, o, h, l, c, v: q.volume[i] ?? 0 });
    });
    if (candles.length < 20) return null;
    return { candles, price: r.meta.regularMarketPrice, time: r.meta.regularMarketTime };
  } catch {
    return null;
  }
}

export type StockTf = "1m" | "5m" | "1h" | "4h" | "1d";
export const STOCK_TFS: StockTf[] = ["1m", "5m", "1h", "4h", "1d"];

/**
 * Intraday candles for a stock chart (display only — the swing rules stay on
 * daily candles). 4H groups each session's hourly bars in fours from the open,
 * like TradingView (NSE: 09:15 and 13:15; US: 09:30 and 13:30).
 */
export async function stockIntraday(symbol: string, market: Market, tf: Exclude<StockTf, "1d">): Promise<Candle[] | null> {
  const map = { "1m": ["1m", "2d"], "5m": ["5m", "5d"], "1h": ["60m", "3mo"], "4h": ["60m", "6mo"] } as const;
  const [interval, range] = map[tf];
  const d = await getIntraday(yahooSymbol(symbol, market), interval, range, tf === "1m" ? 20 : 60);
  if (!d) return null;
  if (tf !== "4h") return d.candles;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York" });
  const out: Candle[] = [];
  let curDay = "", n = 0;
  for (const c of d.candles) {
    const k = day.format(new Date(c.t * 1000));
    if (k !== curDay) { curDay = k; n = 0; }
    if (n % 4 === 0) out.push({ ...c });
    else {
      const b = out[out.length - 1];
      b.h = Math.max(b.h, c.h); b.l = Math.min(b.l, c.l); b.c = c.c; b.v += c.v;
    }
    n++;
  }
  return out;
}
