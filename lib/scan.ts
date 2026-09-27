// One pass over a market: the index first (it feeds the v2 market and
// relative-strength rules), then every stock in the universe.

import "server-only";
import { analyse, indexContext, type Analysis, type IndexContext } from "./setup";
import { getSeries, mapLimit, type Quote } from "./market";
import { INDEX, UNIVERSE, type Stock } from "./universe";
import type { Market } from "./plan";
import type { Candle } from "./indicators";

export type Row = { stock: Stock; quote: Quote | null; analysis: Analysis | null };

export type MarketScan = {
  market: Market;
  index: { name: string; quote: Quote | null; ctx: IndexContext };
  rows: Row[];
  scannedAt: number;
};

export async function getIndex(market: Market) {
  const idx = INDEX[market];
  const s = await getSeries(idx.symbol, market, 60);
  return { name: idx.name, quote: s?.quote ?? null, ctx: indexContext(s?.candles ?? null), candles: s?.candles ?? null };
}

export async function scanMarket(market: Market): Promise<MarketScan> {
  const index = await getIndex(market);
  const rows = await mapLimit(UNIVERSE[market], 8, async (stock): Promise<Row> => {
    const s = await getSeries(stock.symbol, market, 90);
    return { stock, quote: s?.quote ?? null, analysis: s ? analyse(s.candles, index.ctx) : null };
  });
  return { market, index: { name: index.name, quote: index.quote, ctx: index.ctx }, rows, scannedAt: Date.now() };
}

export async function analyseOne(stock: Stock): Promise<{
  quote: Quote | null;
  candles: Candle[];
  forming: Candle | null;
  analysis: Analysis | null;
  index: Awaited<ReturnType<typeof getIndex>>;
}> {
  const [index, s] = await Promise.all([getIndex(stock.market), getSeries(stock.symbol, stock.market, 30)]);
  return {
    quote: s?.quote ?? null,
    candles: s?.candles ?? [],
    forming: s?.forming ?? null,
    analysis: s ? analyse(s.candles, index.ctx) : null,
    index,
  };
}
