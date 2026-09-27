import type { Market } from "./plan";

export function money(x: number | null | undefined, market: Market, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
    style: "currency",
    currency: market === "IN" ? "INR" : "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(x);
}

export const pct = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;

export const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4).replace(/0+$/, ""));

/** "5 min ago" style, for quote freshness. */
export function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const tone = (x: number | null | undefined) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
