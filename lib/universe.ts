// Scan universes. India: the NIFTY 50 list from the original sheet. US: the
// Dow 30 list from the sheet plus the stocks held in MyPortfolio.
// Yahoo symbols: NSE tickers take a ".NS" suffix; "&" and "-" pass through.

import type { Market } from "./plan";

export type Stock = { symbol: string; name: string; market: Market };

const IN: [string, string][] = [
  ["BAJFINANCE", "Bajaj Finance Ltd"],
  ["TATACONSUM", "Tata Consumer Products Ltd"],
  ["HDFCBANK", "HDFC Bank Ltd"],
  ["APOLLOHOSP", "Apollo Hospitals Enterprise Ltd"],
  ["NESTLEIND", "Nestle India Ltd"],
  ["ICICIBANK", "ICICI Bank Ltd"],
  ["ASIANPAINT", "Asian Paints Ltd"],
  ["AXISBANK", "Axis Bank Ltd"],
  ["KOTAKBANK", "Kotak Mahindra Bank Ltd"],
  ["ITC", "ITC Ltd"],
  ["HINDUNILVR", "Hindustan Unilever Ltd"],
  ["ETERNAL", "Eternal Ltd"],
  ["SHRIRAMFIN", "Shriram Finance Ltd"],
  ["BHARTIARTL", "Bharti Airtel Ltd"],
  ["M&M", "Mahindra And Mahindra Ltd"],
  ["BAJAJFINSV", "Bajaj Finserv Ltd"],
  ["ULTRACEMCO", "UltraTech Cement Ltd"],
  ["HDFCLIFE", "HDFC Life Insurance Company Ltd"],
  ["GRASIM", "Grasim Industries Ltd"],
  ["SBIN", "State Bank of India"],
  ["TITAN", "Titan Company Ltd"],
  ["POWERGRID", "Power Grid Corporation of India Ltd"],
  ["MARUTI", "Maruti Suzuki India Ltd"],
  ["TRENT", "Trent Ltd"],
  ["SBILIFE", "SBI Life Insurance Company Ltd"],
  ["NTPC", "NTPC Ltd"],
  ["HEROMOTOCO", "Hero Motocorp Ltd"],
  ["BEL", "Bharat Electronics Ltd"],
  ["EICHERMOT", "Eicher Motors Ltd"],
  ["BAJAJ-AUTO", "Bajaj Auto Ltd"],
  ["INFY", "Infosys Ltd"],
  ["TCS", "Tata Consultancy Services Ltd"],
  ["COALINDIA", "Coal India Limited"],
  ["HCLTECH", "HCL Technologies Ltd"],
  ["ADANIENT", "Adani Enterprises Limited"],
  ["DRREDDY", "Dr Reddy's Laboratories Ltd"],
  ["JIOFIN", "Jio Financial Services Ltd"],
  ["JSWSTEEL", "JSW Steel Ltd"],
  ["RELIANCE", "Reliance Industries Ltd"],
  ["TECHM", "Tech Mahindra Ltd"],
  ["INDUSINDBK", "Indusind Bank Ltd"],
  ["SUNPHARMA", "Sun Pharmaceutical Industries Ltd"],
  ["WIPRO", "Wipro Ltd"],
  ["ADANIPORTS", "Adani Ports and Special Economic Zone Ltd"],
  ["LT", "Larsen and Toubro Ltd"],
  ["CIPLA", "Cipla Ltd"],
  ["TATAMOTORS", "Tata Motors Ltd"],
  ["ONGC", "Oil and Natural Gas Corporation Ltd"],
  ["HINDALCO", "Hindalco Industries Ltd"],
  ["TATASTEEL", "Tata Steel Ltd"],
  ["ZEEL", "Zee Entertainment Enterprises Ltd"],
];

const US: [string, string][] = [
  ["NVDA", "NVIDIA Corporation"],
  ["MSFT", "Microsoft Corporation"],
  ["AAPL", "Apple Inc."],
  ["AMZN", "Amazon.com, Inc."],
  ["JPM", "JPMorgan Chase & Co."],
  ["WMT", "Walmart Inc."],
  ["V", "Visa Inc."],
  ["JNJ", "Johnson & Johnson"],
  ["HD", "The Home Depot, Inc."],
  ["PG", "The Procter & Gamble Company"],
  ["CVX", "Chevron Corporation"],
  ["KO", "The Coca-Cola Company"],
  ["UNH", "UnitedHealth Group Incorporated"],
  ["CSCO", "Cisco Systems, Inc."],
  ["CRM", "Salesforce, Inc."],
  ["GS", "The Goldman Sachs Group, Inc."],
  ["AXP", "American Express Company"],
  ["IBM", "International Business Machines Corporation"],
  ["MCD", "McDonald's Corporation"],
  ["DIS", "The Walt Disney Company"],
  ["MRK", "Merck & Co., Inc."],
  ["CAT", "Caterpillar Inc."],
  ["VZ", "Verizon Communications Inc."],
  ["BA", "The Boeing Company"],
  ["AMGN", "Amgen Inc."],
  ["HON", "Honeywell International Inc."],
  ["NKE", "NIKE, Inc."],
  ["SHW", "The Sherwin-Williams Company"],
  ["MMM", "3M Company"],
  ["TRV", "The Travelers Companies, Inc."],
  ["ADBE", "Adobe Inc"],
];

export const UNIVERSE: Record<Market, Stock[]> = {
  IN: IN.map(([symbol, name]) => ({ symbol, name, market: "IN" })),
  US: US.map(([symbol, name]) => ({ symbol, name, market: "US" })),
};

/** The index each market is measured against. */
export const INDEX: Record<Market, { symbol: string; name: string }> = {
  IN: { symbol: "^NSEI", name: "NIFTY 50" },
  US: { symbol: "^GSPC", name: "S&P 500" },
};

export const CURRENCY: Record<Market, string> = { IN: "INR", US: "USD" };

/** App symbol → Yahoo symbol. */
export function yahooSymbol(symbol: string, market: Market): string {
  if (symbol.startsWith("^") || symbol.includes("=")) return symbol;
  return market === "IN" ? `${symbol}.NS` : symbol.replace(".", "-");
}

export function findStock(symbol: string, market?: Market): Stock | undefined {
  const s = symbol.toUpperCase();
  const pool = market ? UNIVERSE[market] : [...UNIVERSE.IN, ...UNIVERSE.US];
  return pool.find((x) => x.symbol === s);
}
