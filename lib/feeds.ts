// Intraday data for the Forex/Commodities and Crypto desks.
// Server-only; every source fails soft to null / [] rather than inventing data.
//
// Source order per instrument:
//   1. OANDA (real-time, same feed as TradingView's OANDA charts) when
//      OANDA_TOKEN is set — forex, metals, oil, gas.
//   2. Kraken public API (real-time, no key) — crypto.
//   3. Yahoo Finance — free fallback, delayed; futures trade slightly off spot.
// The page always says which one it used.

import "server-only";
import { getIntraday } from "./market";
import type { Candle } from "./indicators";
import type { Instrument } from "./instruments";

export type Tf = "1m" | "5m" | "15m" | "1h" | "4h";
export const TFS: Tf[] = ["1m", "5m", "15m", "1h", "4h"];

export type Feed = { candles: Candle[]; price: number; time: number; source: string; live: boolean };

// ---- OANDA ------------------------------------------------------------------

type OandaCandles = { candles?: { complete: boolean; volume: number; time: string; mid?: { o: string; h: string; l: string; c: string } }[] };
const oandaHost = () => (process.env.OANDA_ENV === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com");

async function oanda(instrument: string, granularity: string, count: number): Promise<Candle[] | null> {
  const token = process.env.OANDA_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://${oandaHost()}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`, {
      headers: { Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "UNIX" },
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OandaCandles;
    const cs = (data.candles ?? []).filter((c) => c.mid).map((c) => ({ t: Math.floor(Number(c.time)), o: +c.mid!.o, h: +c.mid!.h, l: +c.mid!.l, c: +c.mid!.c, v: c.volume }));
    return cs.length ? cs : null;
  } catch {
    return null;
  }
}

// ---- Kraken -----------------------------------------------------------------

type KrakenOHLC = { error: string[]; result?: Record<string, (string | number)[][] | number> };

async function kraken(pair: string, minutes: number): Promise<Candle[] | null> {
  try {
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${minutes}`, { next: { revalidate: 10 } });
    if (!res.ok) return null;
    const data = (await res.json()) as KrakenOHLC;
    if (data.error?.length || !data.result) return null;
    const key = Object.keys(data.result).find((k) => k !== "last");
    const rows = key ? (data.result[key] as (string | number)[][]) : [];
    const cs = rows.map((r) => ({ t: Number(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] }));
    return cs.length ? cs : null;
  } catch {
    return null;
  }
}

// ---- Yahoo ------------------------------------------------------------------

/** Group hourly candles into 4-hour candles starting at 17:00, 21:00, 01:00 … New York. */
function to4h(cs: Candle[]): Candle[] {
  const out: Candle[] = [];
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
  let cur: Candle | null = null;
  let bucket = -1;
  for (const c of cs) {
    const h = Number(f.format(new Date(c.t * 1000))) % 24;
    const start = c.t - ((h - 17 + 24) % 4) * 3600 - (c.t % 3600);
    if (start !== bucket || !cur) {
      cur = { t: start, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
      out.push(cur);
      bucket = start;
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  return out;
}

const YAHOO: Record<Tf, [string, string]> = { "1m": ["1m", "2d"], "5m": ["5m", "5d"], "15m": ["15m", "1mo"], "1h": ["60m", "3mo"], "4h": ["60m", "6mo"] };
const OANDA_G: Record<Tf, string> = { "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4" };
const KRAKEN_M: Record<Tf, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240 };

/** Candles for an instrument at a timeframe, from the best source available. */
export async function candles(inst: Instrument, tf: Tf = "5m"): Promise<Feed | null> {
  const now = Math.floor(Date.now() / 1000);
  if (inst.oanda) {
    const cs = await oanda(inst.oanda, OANDA_G[tf], tf === "1m" ? 1200 : 1500);
    if (cs && cs.length >= 20) return { candles: cs, price: cs[cs.length - 1].c, time: now, source: `OANDA ${inst.oanda.replace("_", "/")} · real-time`, live: true };
  }
  if (inst.kraken) {
    const cs = await kraken(inst.kraken, KRAKEN_M[tf]);
    if (cs && cs.length >= 20) return { candles: cs, price: cs[cs.length - 1].c, time: now, source: "Kraken · real-time", live: true };
  }
  const [interval, range] = YAHOO[tf];
  for (const y of inst.yahoo) {
    const d = await getIntraday(y, interval, range, tf === "1m" ? 30 : 60);
    if (d) {
      const fut = y.endsWith("=F");
      return {
        candles: tf === "4h" ? to4h(d.candles) : d.candles,
        price: d.price,
        time: d.time,
        source: `${y} (Yahoo, delayed${fut ? " · futures, trades off spot" : ""})`,
        live: false,
      };
    }
  }
  return null;
}

// ---- Quotes for the instrument strip ------------------------------------------

export type Quote = { id: string; price: number; changePct: number | null; spark: number[] };

/** Last price, change on the day and a small hourly sparkline for each instrument. */
export async function quotes(list: Instrument[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  await Promise.all(
    list.map(async (inst) => {
      let cs: Candle[] | null = null;
      if (inst.oanda) cs = await oanda(inst.oanda, "H1", 30);
      if (!cs && inst.kraken) cs = await kraken(inst.kraken, 60);
      if (!cs)
        for (const y of inst.yahoo) {
          const d = await getIntraday(y, "60m", "5d", 60);
          if (d) { cs = d.candles; cs[cs.length - 1] = { ...cs[cs.length - 1], c: d.price }; break; }
        }
      if (!cs?.length) return;
      const last = cs[cs.length - 1].c;
      const dayAgo = cs.find((c) => c.t >= cs![cs!.length - 1].t - 86400)?.o ?? cs[0].o;
      out[inst.id] = { id: inst.id, price: last, changePct: dayAgo ? ((last - dayAgo) / dayAgo) * 100 : null, spark: cs.slice(-24).map((c) => c.c) };
    }),
  );
  return out;
}

// ---- News & calendar -----------------------------------------------------------

export type Headline = { title: string; link: string; source: string; time: number };

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Latest headlines for an instrument from Google News (RSS), newest first. */
export async function headlines(query: string, limit = 12): Promise<Headline[]> {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(`${query} when:2d`) + "&hl=en-US&gl=US&ceid=US:en";
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

export type EconEvent = { title: string; time: number; impact: string; forecast: string; previous: string; country: string };

/** This week's high/medium-impact events for the given currencies (Forex Factory's public feed). */
export async function calendar(currencies: string[]): Promise<EconEvent[]> {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const rows = (await res.json()) as { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }[];
    return rows
      .filter((r) => currencies.includes(r.country) && (r.impact === "High" || r.impact === "Medium"))
      .map((r) => ({ title: r.title, country: r.country, time: Math.floor(Date.parse(r.date) / 1000), impact: r.impact, forecast: r.forecast ?? "", previous: r.previous ?? "" }))
      .filter((r) => r.time)
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}
