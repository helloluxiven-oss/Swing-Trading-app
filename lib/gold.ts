// Gold desk data: intraday candles, headlines and the USD event calendar.
// Server-only; every source fails soft to null / [] rather than inventing data.

import "server-only";
import { getIntraday } from "./market";

/**
 * Yahoo first tries spot (XAUUSD=X); if that is not served it falls back to
 * COMEX gold futures (GC=F), which trade a few dollars above OANDA spot. The
 * page says which one it is using — levels are relative, so the strategy works
 * on either, but don't copy absolute prices onto a spot chart without checking.
 */
const SOURCES = [
  { symbol: "XAUUSD=X", label: "XAU/USD spot" },
  { symbol: "GC=F", label: "COMEX gold futures (GC=F)" },
];

export async function goldCandles() {
  for (const s of SOURCES) {
    const d = await getIntraday(s.symbol, "5m", "5d", 60);
    if (d) return { ...d, source: s.label, symbol: s.symbol };
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
