// Gold desk data: intraday candles, headlines and the USD event calendar.
// Server-only; every source fails soft to null / [] rather than inventing data.

import "server-only";
import { getIntraday } from "./market";
import type { Candle } from "./indicators";

/**
 * Source order:
 * 1. OANDA XAU_USD (real-time spot, the same feed as the TradingView OANDA
 *    chart) when OANDA_TOKEN is set on the server. A free practice-account
 *    token is enough — it only reads prices, it cannot trade on its own.
 * 2. Yahoo spot (XAUUSD=X), then COMEX futures (GC=F). Free, but delayed, and
 *    futures trade a few dollars above spot. The page says which one it used.
 */
export const OANDA_ON = !!process.env.OANDA_TOKEN;

type OandaCandles = { candles?: { complete: boolean; volume: number; time: string; mid?: { o: string; h: string; l: string; c: string } }[] };

async function oandaCandles(granularity = "M5", count = 1500) {
  const token = process.env.OANDA_TOKEN;
  if (!token) return null;
  const host = process.env.OANDA_ENV === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
  try {
    const res = await fetch(`https://${host}/v3/instruments/XAU_USD/candles?granularity=${granularity}&count=${count}&price=M`, {
      headers: { Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "UNIX" },
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OandaCandles;
    const candles: Candle[] = (data.candles ?? [])
      .filter((c) => c.mid)
      .map((c) => ({ t: Math.floor(Number(c.time)), o: +c.mid!.o, h: +c.mid!.h, l: +c.mid!.l, c: +c.mid!.c, v: c.volume }));
    if (candles.length < 20) return null;
    const last = candles[candles.length - 1];
    return { candles, price: last.c, time: Math.floor(Date.now() / 1000), source: "OANDA XAU/USD spot · real-time", symbol: "XAU_USD", live: true };
  } catch {
    return null;
  }
}

const SOURCES = [
  { symbol: "XAUUSD=X", label: "XAU/USD spot (Yahoo, delayed)" },
  { symbol: "GC=F", label: "COMEX gold futures GC=F (Yahoo, delayed ~10 min, trades above spot)" },
];

export type Tf = "1m" | "5m" | "15m" | "1h" | "4h";
export const TFS: Tf[] = ["1m", "5m", "15m", "1h", "4h"];

/**
 * Candles for the CHART at any timeframe. The strategy itself always runs on
 * 5-minute candles (goldCandles); this only changes what you look at.
 * 4H bars are aligned to gold's 17:00 New York day roll, like TradingView.
 */
export async function goldChart(tf: Tf) {
  const oandaGran: Record<Tf, string> = { "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4" };
  const o = await oandaCandles(oandaGran[tf], tf === "1m" ? 1200 : 1500);
  if (o) return o;
  const yahoo: Record<Tf, [string, string]> = { "1m": ["1m", "2d"], "5m": ["5m", "5d"], "15m": ["15m", "1mo"], "1h": ["60m", "3mo"], "4h": ["60m", "6mo"] };
  const [interval, range] = yahoo[tf];
  for (const s of SOURCES) {
    const d = await getIntraday(s.symbol, interval, range, tf === "1m" ? 30 : 60);
    if (d) return { ...d, candles: tf === "4h" ? to4h(d.candles) : d.candles, source: s.label, symbol: s.symbol, live: false };
  }
  return null;
}

/** Group hourly candles into 4-hour candles starting at 17:00, 21:00, 01:00 … New York. */
function to4h(cs: Candle[]): Candle[] {
  const out: Candle[] = [];
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
  let cur: Candle | null = null;
  let bucket = "";
  for (const c of cs) {
    const h = Number(f.format(new Date(c.t * 1000))) % 24;
    const start = c.t - (((h - 17 + 24) % 4) * 3600) - (c.t % 3600);
    const k = String(start);
    if (k !== bucket || !cur) {
      cur = { t: start, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
      out.push(cur);
      bucket = k;
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  return out;
}

export async function goldCandles() {
  const o = await oandaCandles();
  if (o) return o;
  for (const s of SOURCES) {
    const d = await getIntraday(s.symbol, "5m", "5d", 60);
    if (d) return { ...d, source: s.label, symbol: s.symbol, live: false };
  }
  return null;
}

export type Headline = { title: string; link: string; source: string; time: number };

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Latest gold headlines from Google News (RSS), newest first. */
export async function goldNews(limit = 12): Promise<Headline[]> {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent("gold price OR XAUUSD OR \"spot gold\" when:2d") + "&hl=en-US&gl=US&ceid=US:en";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 600 } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const x = m[1];
      const get = (tag: string) => decode(x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      const source = get("source");
      let title = get("title");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      return { title, link: get("link"), source, time: Math.floor(Date.parse(get("pubDate")) / 1000) || 0 };
    });
    return items.filter((i) => i.title && i.link).sort((a, b) => b.time - a.time).slice(0, limit);
  } catch {
    return [];
  }
}

export type EconEvent = { title: string; time: number; impact: string; forecast: string; previous: string };

/** This week's high/medium-impact USD events (Forex Factory's public feed). */
export async function usdEvents(): Promise<EconEvent[]> {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const rows = (await res.json()) as { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }[];
    return rows
      .filter((r) => r.country === "USD" && (r.impact === "High" || r.impact === "Medium"))
      .map((r) => ({ title: r.title, time: Math.floor(Date.parse(r.date) / 1000), impact: r.impact, forecast: r.forecast ?? "", previous: r.previous ?? "" }))
      .filter((r) => r.time)
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}
