// Instruments for the intraday desks (the liquidity-sweep strategy).
//
// Each one says where its prices come from (OANDA when a token is set, Kraken
// for crypto, Yahoo as the delayed fallback), how many decimals it trades in,
// and how big one lot is — so the plan and position size are right per market.

export type DeskKind = "fx" | "crypto";

export type Instrument = {
  id: string; // URL id, e.g. XAUUSD
  name: string;
  short: string; // chip label
  kind: DeskKind;
  group: "Metals" | "Forex" | "Energy" | "Crypto";
  yahoo: string[]; // tried in order
  oanda?: string;
  kraken?: string;
  precision: number;
  /** Units per standard lot (oz, units, barrels…); crypto trades in coins. */
  lot: number;
  unit: string;
  /** Currency the price is quoted in (P/L currency per unit). */
  quote: string;
  /** Currencies whose red news moves it. */
  news: string[];
  query: string; // headline search
  pinned?: boolean;
};

/** The liquidity-sweep strategy runs on every instrument (a market view remains available by returning false here). */
export const hasStrategy = (_i: Instrument) => true;

export const INSTRUMENTS: Instrument[] = [
  // ---- Forex & commodities (XAU pinned first) ----
  { id: "XAUUSD", name: "Gold", short: "XAU", kind: "fx", group: "Metals", yahoo: ["XAUUSD=X", "GC=F"], oanda: "XAU_USD", precision: 2, lot: 100, unit: "oz", quote: "USD", news: ["USD"], query: 'gold price OR XAUUSD OR "spot gold"', pinned: true },
  { id: "XAGUSD", name: "Silver", short: "XAG", kind: "fx", group: "Metals", yahoo: ["XAGUSD=X", "SI=F"], oanda: "XAG_USD", precision: 3, lot: 5000, unit: "oz", quote: "USD", news: ["USD"], query: 'silver price OR XAGUSD' },
  { id: "EURUSD", name: "Euro / US Dollar", short: "EURUSD", kind: "fx", group: "Forex", yahoo: ["EURUSD=X"], oanda: "EUR_USD", precision: 5, lot: 100000, unit: "units", quote: "USD", news: ["USD", "EUR"], query: "EURUSD OR euro dollar forex" },
  { id: "GBPUSD", name: "British Pound / US Dollar", short: "GBPUSD", kind: "fx", group: "Forex", yahoo: ["GBPUSD=X"], oanda: "GBP_USD", precision: 5, lot: 100000, unit: "units", quote: "USD", news: ["USD", "GBP"], query: "GBPUSD OR pound sterling dollar" },
  { id: "USDJPY", name: "US Dollar / Japanese Yen", short: "USDJPY", kind: "fx", group: "Forex", yahoo: ["JPY=X"], oanda: "USD_JPY", precision: 3, lot: 100000, unit: "units", quote: "JPY", news: ["USD", "JPY"], query: "USDJPY OR dollar yen" },
  { id: "AUDUSD", name: "Australian Dollar / US Dollar", short: "AUDUSD", kind: "fx", group: "Forex", yahoo: ["AUDUSD=X"], oanda: "AUD_USD", precision: 5, lot: 100000, unit: "units", quote: "USD", news: ["USD", "AUD"], query: "AUDUSD OR aussie dollar" },
  { id: "USDCAD", name: "US Dollar / Canadian Dollar", short: "USDCAD", kind: "fx", group: "Forex", yahoo: ["CAD=X"], oanda: "USD_CAD", precision: 5, lot: 100000, unit: "units", quote: "CAD", news: ["USD", "CAD"], query: "USDCAD OR loonie dollar" },
  { id: "USDCHF", name: "US Dollar / Swiss Franc", short: "USDCHF", kind: "fx", group: "Forex", yahoo: ["CHF=X"], oanda: "USD_CHF", precision: 5, lot: 100000, unit: "units", quote: "CHF", news: ["USD", "CHF"], query: "USDCHF OR swiss franc dollar" },
  { id: "NZDUSD", name: "New Zealand Dollar / US Dollar", short: "NZDUSD", kind: "fx", group: "Forex", yahoo: ["NZDUSD=X"], oanda: "NZD_USD", precision: 5, lot: 100000, unit: "units", quote: "USD", news: ["USD", "NZD"], query: "NZDUSD OR kiwi dollar" },
  { id: "USOIL", name: "WTI Crude Oil", short: "WTI", kind: "fx", group: "Energy", yahoo: ["CL=F"], oanda: "WTICO_USD", precision: 2, lot: 1000, unit: "bbl", quote: "USD", news: ["USD"], query: "crude oil price OR WTI" },
  { id: "UKOIL", name: "Brent Crude Oil", short: "Brent", kind: "fx", group: "Energy", yahoo: ["BZ=F"], oanda: "BCO_USD", precision: 2, lot: 1000, unit: "bbl", quote: "USD", news: ["USD"], query: "brent crude price" },
  { id: "NATGAS", name: "Natural Gas", short: "NGAS", kind: "fx", group: "Energy", yahoo: ["NG=F"], oanda: "NATGAS_USD", precision: 3, lot: 10000, unit: "MMBtu", quote: "USD", news: ["USD"], query: "natural gas price" },

  // ---- Crypto (BTC pinned first) ----
  { id: "BTC", name: "Bitcoin", short: "BTC", kind: "crypto", group: "Crypto", yahoo: ["BTC-USD"], kraken: "XBTUSD", precision: 1, lot: 1, unit: "BTC", quote: "USD", news: ["USD"], query: "bitcoin price OR BTC", pinned: true },
  { id: "ETH", name: "Ethereum", short: "ETH", kind: "crypto", group: "Crypto", yahoo: ["ETH-USD"], kraken: "ETHUSD", precision: 2, lot: 1, unit: "ETH", quote: "USD", news: ["USD"], query: "ethereum price OR ETH crypto" },
  { id: "SOL", name: "Solana", short: "SOL", kind: "crypto", group: "Crypto", yahoo: ["SOL-USD"], kraken: "SOLUSD", precision: 2, lot: 1, unit: "SOL", quote: "USD", news: ["USD"], query: "solana price OR SOL crypto" },
  { id: "XRP", name: "XRP", short: "XRP", kind: "crypto", group: "Crypto", yahoo: ["XRP-USD"], kraken: "XRPUSD", precision: 4, lot: 1, unit: "XRP", quote: "USD", news: ["USD"], query: "XRP price ripple" },
  { id: "BNB", name: "BNB", short: "BNB", kind: "crypto", group: "Crypto", yahoo: ["BNB-USD"], precision: 2, lot: 1, unit: "BNB", quote: "USD", news: ["USD"], query: "BNB price binance coin" },
  { id: "DOGE", name: "Dogecoin", short: "DOGE", kind: "crypto", group: "Crypto", yahoo: ["DOGE-USD"], kraken: "XDGUSD", precision: 5, lot: 1, unit: "DOGE", quote: "USD", news: ["USD"], query: "dogecoin price" },
  { id: "ADA", name: "Cardano", short: "ADA", kind: "crypto", group: "Crypto", yahoo: ["ADA-USD"], kraken: "ADAUSD", precision: 4, lot: 1, unit: "ADA", quote: "USD", news: ["USD"], query: "cardano ADA price" },
  { id: "AVAX", name: "Avalanche", short: "AVAX", kind: "crypto", group: "Crypto", yahoo: ["AVAX-USD"], kraken: "AVAXUSD", precision: 2, lot: 1, unit: "AVAX", quote: "USD", news: ["USD"], query: "avalanche AVAX price" },
  { id: "LINK", name: "Chainlink", short: "LINK", kind: "crypto", group: "Crypto", yahoo: ["LINK-USD"], kraken: "LINKUSD", precision: 3, lot: 1, unit: "LINK", quote: "USD", news: ["USD"], query: "chainlink LINK price" },
  { id: "LTC", name: "Litecoin", short: "LTC", kind: "crypto", group: "Crypto", yahoo: ["LTC-USD"], kraken: "LTCUSD", precision: 2, lot: 1, unit: "LTC", quote: "USD", news: ["USD"], query: "litecoin price" },
];

export const DESKS: Record<DeskKind, { title: string; path: string; pinned: string; blurb: string }> = {
  fx: { title: "Forex & Commodities", path: "/fx", pinned: "XAUUSD", blurb: "Gold, silver, oil, gas and the major pairs" },
  crypto: { title: "Crypto", path: "/crypto", pinned: "BTC", blurb: "Bitcoin and the large caps · 24/7" },
};

export const deskInstruments = (k: DeskKind) => INSTRUMENTS.filter((i) => i.kind === k);
export const findInstrument = (k: DeskKind, id?: string) =>
  deskInstruments(k).find((i) => i.id === id?.toUpperCase()) ?? deskInstruments(k).find((i) => i.id === DESKS[k].pinned)!;

/**
 * Position size for a stop `riskPrice` away, risking `riskUsd`.
 * Returns lots (FX/commodities) or coins (crypto). For pairs quoted in another
 * currency (USDJPY, USDCAD, USDCHF) the stop distance is converted at `price`.
 */
export function sizeFor(inst: Instrument, riskUsd: number, riskPrice: number, price: number): { amount: number; label: string } | null {
  if (!(riskPrice > 0) || !(riskUsd > 0)) return null;
  const perUnitUsd = inst.quote === "USD" ? riskPrice : riskPrice / price;
  const units = riskUsd / perUnitUsd;
  if (inst.kind === "crypto") return { amount: units, label: `${units < 1 ? units.toFixed(4) : units.toFixed(2)} ${inst.unit}` };
  const lots = units / inst.lot;
  return { amount: lots, label: `${lots.toFixed(2)} lots` };
}

/** Format a price at the instrument's precision. */
export const fmtPrice = (inst: Instrument, x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("en-US", { minimumFractionDigits: inst.precision, maximumFractionDigits: inst.precision });
