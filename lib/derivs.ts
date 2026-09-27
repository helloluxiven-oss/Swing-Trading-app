// Options & futures data for the F&O desk. Server-only; every source fails
// soft (null) instead of inventing numbers.
//
//   Crypto (BTC, ETH) — Deribit public API: the largest crypto options venue.
//     Real-time, no key. Option chain (OI, mark IV, prices), futures and the
//     perpetual (basis, funding), DVOL (crypto's VIX).
//   India (NIFTY, SENSEX) — NSE / BSE website APIs. They are built for their
//     own pages and often refuse cloud servers; when they do, the page says so
//     (a broker API such as Upstox or Dhan is the dependable fix).
//   FII / DII cash-market flows — NSE's daily provisional figures.

import "server-only";
import { bsPrice, type ChainRow } from "./options";
import { getIntraday } from "./market";

export type Underlying = "NIFTY" | "SENSEX" | "BTC" | "ETH";
export const UNDERLYINGS: { id: Underlying; name: string; market: "india" | "crypto"; lot: number; currency: string }[] = [
  { id: "NIFTY", name: "NIFTY 50", market: "india", lot: 75, currency: "₹" },
  { id: "SENSEX", name: "SENSEX", market: "india", lot: 20, currency: "₹" },
  { id: "BTC", name: "Bitcoin", market: "crypto", lot: 1, currency: "$" },
  { id: "ETH", name: "Ethereum", market: "crypto", lot: 1, currency: "$" },
];

export type Future = { name: string; expiry: number | null; price: number; basisPct: number | null; annualisedPct: number | null; oi: number | null; funding8h?: number | null };

export type Chain = {
  underlying: Underlying;
  spot: number;
  expiries: { ts: number; label: string }[];
  expiry: number; // selected
  rows: ChainRow[];
  futures: Future[];
  volIndex: { name: string; value: number; change: number | null } | null;
  source: string;
  /** Set when the chain is modelled rather than quoted (e.g. SENSEX from NIFTY). */
  proxy?: string;
  live: boolean;
  time: number;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const expLabel = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });

// ---- Deribit ----------------------------------------------------------------------

type DeribitSummary = {
  instrument_name: string;
  open_interest: number;
  mark_iv?: number;
  mark_price: number;
  underlying_price?: number;
  volume?: number;
  funding_8h?: number;
  estimated_delivery_price?: number;
};

async function deribit<T>(path: string, revalidate = 20): Promise<T | null> {
  try {
    const r = await fetch(`https://www.deribit.com/api/v2/public/${path}`, { next: { revalidate } });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

/** "BTC-27SEP26-60000-C" → { expiry, strike, type } (Deribit expiries settle 08:00 UTC). */
function parseDeribit(name: string) {
  const m = name.match(/^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-(C|P)$/);
  if (!m) return null;
  const expiry = Date.UTC(2000 + +m[3], MONTHS[m[2]], +m[1], 8) / 1000;
  return { expiry, strike: +m[4].replace("d", "."), type: m[5] === "C" ? "call" : "put" };
}

async function cryptoChain(u: "BTC" | "ETH", pick?: number): Promise<Chain | null> {
  const [opts, futs, idx, dvol] = await Promise.all([
    deribit<DeribitSummary[]>(`get_book_summary_by_currency?currency=${u}&kind=option`),
    deribit<DeribitSummary[]>(`get_book_summary_by_currency?currency=${u}&kind=future`),
    deribit<{ index_price: number }>(`get_index_price?index_name=${u.toLowerCase()}_usd`, 10),
    deribit<{ data: number[][] }>(`get_volatility_index_data?currency=${u}&resolution=3600&start_timestamp=${Date.now() - 2 * 86400000}&end_timestamp=${Date.now()}`, 300),
  ]);
  if (!opts?.length || !idx) return null;
  const spot = idx.index_price;
  const now = Date.now() / 1000;
  const parsed = opts.map((o) => ({ o, p: parseDeribit(o.instrument_name) })).filter((x) => x.p && x.p.expiry > now);
  const expiries = [...new Set(parsed.map((x) => x.p!.expiry))].sort((a, b) => a - b);
  // Default: the nearest expiry at least ~1 day out with meaningful OI.
  const oiBy = (e: number) => parsed.filter((x) => x.p!.expiry === e).reduce((s, x) => s + x.o.open_interest, 0);
  const expiry = pick && expiries.includes(pick) ? pick : expiries.find((e) => e - now > 20 * 3600 && oiBy(e) > 100) ?? expiries[0];
  const byStrike = new Map<number, ChainRow>();
  for (const { o, p } of parsed) {
    if (p!.expiry !== expiry) continue;
    const row = byStrike.get(p!.strike) ?? { strike: p!.strike, callOI: 0, putOI: 0, callIV: null, putIV: null, callPrice: null, putPrice: null, callVolume: 0, putVolume: 0 };
    const usd = o.mark_price * (o.underlying_price ?? spot); // Deribit quotes options in the coin
    if (p!.type === "call") { row.callOI = o.open_interest; row.callIV = o.mark_iv ? o.mark_iv / 100 : null; row.callPrice = usd; row.callVolume = o.volume ?? 0; }
    else { row.putOI = o.open_interest; row.putIV = o.mark_iv ? o.mark_iv / 100 : null; row.putPrice = usd; row.putVolume = o.volume ?? 0; }
    byStrike.set(p!.strike, row);
  }
  const futures: Future[] = (futs ?? [])
    .map((f) => {
      const perp = f.instrument_name.endsWith("PERPETUAL");
      const m = f.instrument_name.match(/-(\d{1,2})([A-Z]{3})(\d{2})$/);
      const exp = m ? Date.UTC(2000 + +m[3], MONTHS[m[2]], +m[1], 8) / 1000 : null;
      const basis = ((f.mark_price - spot) / spot) * 100;
      const yrs = exp ? (exp - now) / (365 * 86400) : null;
      return { name: perp ? "Perpetual" : `Future ${exp ? expLabel(exp) : ""}`, expiry: exp, price: f.mark_price, basisPct: basis, annualisedPct: yrs && yrs > 0.01 ? basis / yrs : null, oi: f.open_interest ?? null, funding8h: perp ? f.funding_8h ?? null : undefined };
    })
    .filter((f) => f.expiry === null || f.expiry > now)
    .sort((a, b) => (a.expiry ?? 0) - (b.expiry ?? 0));
  const d = dvol?.data ?? [];
  const last = d[d.length - 1], dayAgo = d[Math.max(0, d.length - 25)];
  return {
    underlying: u,
    spot,
    expiries: expiries.slice(0, 12).map((ts) => ({ ts, label: expLabel(ts) })),
    expiry,
    rows: [...byStrike.values()].sort((a, b) => a.strike - b.strike),
    futures,
    volIndex: last ? { name: `${u} DVOL`, value: last[4], change: dayAgo ? last[4] - dayAgo[4] : null } : null,
    source: "Deribit · real-time",
    live: true,
    time: Math.floor(now),
  };
}

// ---- NSE (NIFTY) ---------------------------------------------------------------------

async function nseCookies(): Promise<string | null> {
  try {
    const r = await fetch("https://www.nseindia.com/option-chain", { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, cache: "no-store" });
    const set = r.headers.getSetCookie?.() ?? [];
    const jar = set.map((c) => c.split(";")[0]).join("; ");
    return jar || null;
  } catch {
    return null;
  }
}

async function nseJson<T>(path: string, cookie: string | null, revalidate = 60): Promise<T | null> {
  try {
    const r = await fetch(`https://www.nseindia.com/api/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.nseindia.com/option-chain", ...(cookie ? { Cookie: cookie } : {}) },
      next: { revalidate },
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t.startsWith("{") || t.startsWith("[") ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}

type NseLeg = { openInterest?: number; changeinOpenInterest?: number; impliedVolatility?: number; lastPrice?: number; totalTradedVolume?: number; underlyingValue?: number };
type NseRow = { strikePrice: number; expiryDate?: string; expiryDates?: string; CE?: NseLeg; PE?: NseLeg };

const nseDate = (s: string) => {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  return m ? Date.UTC(+m[3], MONTHS[m[2].toUpperCase()], +m[1], 10) / 1000 : null; // 15:30 IST
};

async function niftyChain(pick?: number): Promise<Chain | null> {
  const cookie = await nseCookies();
  // NSE has two formats; try the current one, then the older one.
  let rows: NseRow[] = [];
  let spot = 0;
  let expiryStrs: string[] = [];
  const info = await nseJson<{ expiryDates?: string[] }>("option-chain-contract-info?symbol=NIFTY", cookie);
  expiryStrs = info?.expiryDates ?? [];
  if (expiryStrs.length) {
    const want = expiryStrs.find((e) => nseDate(e) === pick) ?? expiryStrs[0];
    const v3 = await nseJson<{ records?: { data?: NseRow[]; underlyingValue?: number } }>(`option-chain-v3?type=Indices&symbol=NIFTY&expiry=${encodeURIComponent(want)}`, cookie);
    rows = v3?.records?.data ?? [];
    spot = v3?.records?.underlyingValue ?? 0;
  }
  if (!rows.length) {
    const old = await nseJson<{ records?: { data?: NseRow[]; expiryDates?: string[]; underlyingValue?: number } }>("option-chain-indices?symbol=NIFTY", cookie);
    expiryStrs = old?.records?.expiryDates ?? expiryStrs;
    const want = expiryStrs.find((e) => nseDate(e) === pick) ?? expiryStrs[0];
    rows = (old?.records?.data ?? []).filter((r) => (r.expiryDate ?? r.expiryDates) === want);
    spot = old?.records?.underlyingValue ?? 0;
  }
  if (!rows.length) return null;
  spot ||= rows.find((r) => r.CE?.underlyingValue)?.CE?.underlyingValue ?? 0;
  const expiries = expiryStrs.map((e) => nseDate(e)).filter((x): x is number => !!x).slice(0, 8);
  const expiry = expiries.find((e) => e === pick) ?? expiries[0];
  const chain: ChainRow[] = rows.map((r) => ({
    strike: r.strikePrice,
    callOI: r.CE?.openInterest ?? 0,
    putOI: r.PE?.openInterest ?? 0,
    callOIChg: r.CE?.changeinOpenInterest ?? 0,
    putOIChg: r.PE?.changeinOpenInterest ?? 0,
    callIV: r.CE?.impliedVolatility ? r.CE.impliedVolatility / 100 : null,
    putIV: r.PE?.impliedVolatility ? r.PE.impliedVolatility / 100 : null,
    callPrice: r.CE?.lastPrice ?? null,
    putPrice: r.PE?.lastPrice ?? null,
    callVolume: r.CE?.totalTradedVolume ?? 0,
    putVolume: r.PE?.totalTradedVolume ?? 0,
  }));
  const futs = await nseJson<{ stocks?: { metadata?: { instrumentType?: string; expiryDate?: string; lastPrice?: number }; marketDeptOrderBook?: { tradeInfo?: { openInterest?: number } } }[] }>("quote-derivative?symbol=NIFTY", cookie);
  const now = Date.now() / 1000;
  const futures: Future[] = (futs?.stocks ?? [])
    .filter((s) => s.metadata?.instrumentType === "Index Futures" && s.metadata.lastPrice)
    .map((s) => {
      const exp = s.metadata!.expiryDate ? nseDate(s.metadata!.expiryDate) : null;
      const basis = ((s.metadata!.lastPrice! - spot) / spot) * 100;
      const yrs = exp ? (exp - now) / (365 * 86400) : null;
      return { name: `Future ${exp ? expLabel(exp) : ""}`, expiry: exp, price: s.metadata!.lastPrice!, basisPct: basis, annualisedPct: yrs && yrs > 0.005 ? basis / yrs : null, oi: s.marketDeptOrderBook?.tradeInfo?.openInterest ?? null };
    })
    .sort((a, b) => (a.expiry ?? 0) - (b.expiry ?? 0));
  const vix = await getIntraday("^INDIAVIX", "1d", "3mo", 300);
  const vc = vix?.candles ?? [];
  return {
    underlying: "NIFTY",
    spot,
    expiries: expiries.map((ts) => ({ ts, label: expLabel(ts) })),
    expiry,
    rows: chain.sort((a, b) => a.strike - b.strike),
    futures,
    volIndex: vix ? { name: "India VIX", value: vix.price, change: vc.length > 1 ? vix.price - vc[vc.length - 2].c : null } : null,
    source: "NSE option chain (about 3 min delayed)",
    live: false,
    time: Math.floor(now),
  };
}

// ---- BSE (SENSEX) -----------------------------------------------------------------------

async function bseJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com" }, next: { revalidate: 60 } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.startsWith("{") || t.startsWith("[") ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}

async function sensexChain(pick?: number): Promise<Chain | null> {
  const exp = await bseJson<{ Table1?: { ExpiryDate?: string }[] }>("https://api.bseindia.com/BseIndiaAPI/api/ddlExpiry_IV/w?ProductType=IO&scrip_cd=1");
  const dates = (exp?.Table1 ?? []).map((x) => x.ExpiryDate).filter((x): x is string => !!x);
  const toTs = (s: string) => { const d = Date.parse(s + " 10:00 UTC"); return Number.isFinite(d) ? d / 1000 : null; };
  const want = dates.find((d) => toTs(d) === pick) ?? dates[0];
  if (!want) return null;
  type B = Record<string, string | number | null>;
  const data = await bseJson<{ Table?: B[] }>(`https://api.bseindia.com/BseIndiaAPI/api/DerivOptionChain_IV/w?Expiry=${encodeURIComponent(want)}&scrip_cd=1&strprice=0`);
  const tbl = data?.Table ?? [];
  if (!tbl.length) return null;
  const num = (v: unknown) => (v == null || v === "" ? 0 : +String(v).replace(/,/g, "")) || 0;
  const pickKey = (r: B, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v != null && v !== "");
  const rows: ChainRow[] = tbl
    .map((r) => ({
      strike: num(pickKey(r, "Strike_Price1", "Strike_Price", "StrikePrice")),
      callOI: num(pickKey(r, "C_Open_Interest", "C_OI")),
      putOI: num(pickKey(r, "Open_Interest", "P_Open_Interest", "P_OI")),
      callOIChg: num(pickKey(r, "C_Absolute_Change_OI", "C_Chng_OI")),
      putOIChg: num(pickKey(r, "Absolute_Change_OI", "P_Absolute_Change_OI", "P_Chng_OI")),
      callIV: num(pickKey(r, "C_IV")) / 100 || null,
      putIV: num(pickKey(r, "IV", "P_IV")) / 100 || null,
      callPrice: num(pickKey(r, "C_Last_Trd_Price", "C_LTP")) || null,
      putPrice: num(pickKey(r, "Last_Trd_Price", "P_Last_Trd_Price", "P_LTP")) || null,
    }))
    .filter((r) => r.strike > 0);
  if (!rows.length) return null;
  const spotRow = await getIntraday("^BSESN", "5m", "1d", 60);
  const spot = spotRow?.price ?? num(pickKey(tbl[0], "UlaValue", "Underlying_Value"));
  const expiries = dates.map(toTs).filter((x): x is number => !!x).slice(0, 8);
  const vix = await getIntraday("^INDIAVIX", "1d", "3mo", 300);
  return {
    underlying: "SENSEX",
    spot,
    expiries: expiries.map((ts) => ({ ts, label: expLabel(ts) })),
    expiry: toTs(want) ?? expiries[0],
    rows: rows.sort((a, b) => a.strike - b.strike),
    futures: [],
    volIndex: vix ? { name: "India VIX", value: vix.price, change: null } : null,
    source: "BSE option chain (delayed)",
    live: false,
    time: Math.floor(Date.now() / 1000),
  };
}

/** Next SENSEX weekly expiry: Thursday 15:30 IST (10:00 UTC), today if before the close. */
function nextThursdayExpiry(now = Date.now()) {
  const d = new Date(now);
  for (let i = 0; i < 8; i++) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i, 10);
    if (new Date(t).getUTCDay() === 4 && t > now) return t / 1000;
  }
  return now / 1000 + 7 * 86400;
}

/**
 * SENSEX options modelled from NIFTY's live chain. The two indices move almost
 * one-for-one, so each SENSEX strike takes NIFTY's implied vol and open-interest
 * shape at the same distance from spot (moneyness), and is priced with
 * Black-Scholes to SENSEX's own Thursday expiry. Prices are estimates, not quotes.
 */
async function sensexProxy(): Promise<Chain | null> {
  const [nifty, sx] = await Promise.all([niftyChain(), getIntraday("^BSESN", "1d", "3mo", 120)]);
  if (!nifty || !nifty.rows.length || !sx) return null;
  const S = sx.price, N0 = nifty.spot;
  const nRows = nifty.rows.filter((r) => r.callIV || r.putIV);
  const at = (m: number) => {
    // nearest NIFTY row by moneyness (strike / spot)
    return nRows.reduce((b, r) => (Math.abs(r.strike / N0 - m) < Math.abs(b.strike / N0 - m) ? r : b), nRows[0]);
  };
  const expiry = nextThursdayExpiry();
  const T = Math.max(expiry - Date.now() / 1000, 3600) / (365 * 86400);
  const rows: ChainRow[] = [];
  const lo = Math.floor((S * 0.93) / 100) * 100, hi = Math.ceil((S * 1.07) / 100) * 100;
  const scale = (S / N0) * 0.35; // SENSEX lots are smaller and volumes lower; keep OI as a shape, not a count
  for (let k = lo; k <= hi; k += 100) {
    const n = at(k / S);
    const civ = n.callIV ?? n.putIV ?? 0.14, piv = n.putIV ?? n.callIV ?? 0.14;
    rows.push({
      strike: k,
      callOI: Math.round(n.callOI * scale), putOI: Math.round(n.putOI * scale),
      callOIChg: Math.round((n.callOIChg ?? 0) * scale), putOIChg: Math.round((n.putOIChg ?? 0) * scale),
      callIV: civ, putIV: piv,
      callPrice: +bsPrice("call", S, k, T, civ, 0.065).toFixed(2), putPrice: +bsPrice("put", S, k, T, piv, 0.065).toFixed(2),
    });
  }
  return {
    underlying: "SENSEX", spot: S,
    expiries: [{ ts: expiry, label: new Date(expiry * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }) }],
    expiry, rows, futures: [], volIndex: nifty.volIndex,
    source: "Modelled from NIFTY's live option chain",
    proxy: "BSE blocks cloud servers, so SENSEX options are modelled from NIFTY's live chain: NIFTY's implied volatility and open-interest shape at the same distance from spot, priced to SENSEX's Thursday expiry. Premiums are estimates — check the real SENSEX price in your broker app before trading.",
    live: false, time: Math.floor(Date.now() / 1000),
  };
}

export async function getChain(u: Underlying, expiry?: number): Promise<Chain | null> {
  const c = u === "BTC" || u === "ETH" ? await cryptoChain(u, expiry) : u === "NIFTY" ? await niftyChain(expiry) : (await sensexChain(expiry)) ?? (await sensexProxy());
  if (c && !c.futures.length) {
    // No futures quote: use the market-implied forward from put-call parity at the ATM strike (F = K + C − P).
    const atm = c.rows.filter((r) => r.callPrice && r.putPrice).reduce<ChainRow | null>((b, r) => (!b || Math.abs(r.strike - c.spot) < Math.abs(b.strike - c.spot) ? r : b), null);
    if (atm && c.spot) {
      const F = atm.strike + atm.callPrice! - atm.putPrice!;
      const now = Date.now() / 1000, yrs = (c.expiry - now) / (365 * 86400);
      const basis = ((F - c.spot) / c.spot) * 100;
      c.futures.push({ name: `Synthetic forward ${expLabel(c.expiry)} (put-call parity)`, expiry: c.expiry, price: F, basisPct: basis, annualisedPct: yrs > 0.005 ? basis / yrs : null, oi: null });
    }
  }
  return c;
}

/** Diagnostics for the health check: what BSE / NSE futures answer from this server. */
export async function derivDiag() {
  const probe = async (url: string, headers: Record<string, string>) => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, cache: "no-store" });
      return { status: r.status, head: (await r.text()).slice(0, 160) };
    } catch (e) {
      return { status: 0, head: String(e).slice(0, 160) };
    }
  };
  return {
    bseExpiry: await probe("https://api.bseindia.com/BseIndiaAPI/api/ddlExpiry_IV/w?ProductType=IO&scrip_cd=1", { Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com", Accept: "application/json" }),
    nseFut: await probe("https://www.nseindia.com/api/quote-derivative?symbol=NIFTY", { Referer: "https://www.nseindia.com/get-quotes/derivatives?symbol=NIFTY", Accept: "application/json", Cookie: (await nseCookies()) ?? "" }),
  };
}

// ---- FII / DII ---------------------------------------------------------------------------

export type Flow = { date: string; fiiNet: number; diiNet: number; fiiBuy: number; fiiSell: number; diiBuy: number; diiSell: number };

/** Latest provisional FII/FPI and DII cash-market flows (₹ crore), from NSE. */
export async function fiiDii(): Promise<Flow | null> {
  const cookie = await nseCookies();
  const d = await nseJson<{ category: string; date: string; buyValue: string; sellValue: string; netValue: string }[]>("fiidiiTradeReact", cookie, 1800);
  if (!d?.length) return null;
  const f = d.find((x) => /FII|FPI/i.test(x.category));
  const i = d.find((x) => /DII/i.test(x.category));
  if (!f || !i) return null;
  const n = (s: string) => +String(s).replace(/,/g, "");
  return { date: f.date, fiiNet: n(f.netValue), diiNet: n(i.netValue), fiiBuy: n(f.buyValue), fiiSell: n(f.sellValue), diiBuy: n(i.buyValue), diiSell: n(i.sellValue) };
}
