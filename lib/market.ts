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
 * Daily candles for ~1 year plus the live quote. Cached for `revalidate` seconds
 * so a page full of stocks does not hammer the source.
 */
export async function getSeries(symbol: string, market: Market, revalidate = 300): Promise<Series | null> {
  const ys = yahooSymbol(symbol, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=1y&interval=1d&includePrePost=false`;
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
  const s = await getSeries("USDINR=X", "US", 900);
  return s?.quote.price ?? null;
}
