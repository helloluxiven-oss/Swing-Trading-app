// Company logo, fetched server-side and cached for a week. Public: logos are
// public brand images, and it lets the browser load them from our own origin.
// 404 when no logo exists — the UI then falls back to a ticker badge.

import { yahooSymbol } from "@/lib/universe";

const WEEK = 7 * 24 * 3600;

export async function GET(_: Request, { params }: { params: Promise<{ market: string; symbol: string }> }) {
  const { market: m, symbol } = await params;
  const market = m === "IN" ? "IN" : "US";
  // Any plain ticker (holdings may be outside the scan universe); nothing else reaches the upstream URL.
  const raw = decodeURIComponent(symbol).toUpperCase();
  if (!/^[A-Z0-9&.-]{1,20}$/.test(raw)) return new Response("bad symbol", { status: 400 });
  const sym = yahooSymbol(raw, market);
  const sources = [`https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`];
  for (const url of sources) {
    try {
      const res = await fetch(url, { next: { revalidate: WEEK } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength < 200) continue; // empty placeholder
      return new Response(body, { headers: { "Content-Type": type, "Cache-Control": `public, max-age=${WEEK}, immutable` } });
    } catch {
      // try the next source
    }
  }
  return new Response("no logo", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
}
