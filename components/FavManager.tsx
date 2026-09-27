"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { addFavourite, moveFavourite, removeFavourite, searchMarkets, type FormState, type SearchHit } from "@/app/actions";

type Fav = { symbol: string; market: "IN" | "US" | "FX" | "CRYPTO"; name: string | null };

const KIND: Record<Fav["market"], string> = { IN: "🇮🇳 NSE", US: "🇺🇸 US", FX: "Forex & commodities", CRYPTO: "₿ Crypto" };
const href = (f: { symbol: string; market: Fav["market"] }) =>
  f.market === "FX" ? `/fx?s=${f.symbol}` : f.market === "CRYPTO" ? `/crypto?s=${f.symbol}` : `/stock/${f.market}/${encodeURIComponent(f.symbol)}`;

/** Search anything, add it, remove it, reorder it. The first three are the dashboard charts. */
export default function FavManager({ favs }: { favs: Fav[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [msg, setMsg] = useState<FormState>(null);
  const [busy, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const has = (h: { symbol: string; market: string }) => favs.some((f) => f.symbol === h.symbol && f.market === h.market);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setHits(await searchMarkets(q)); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="stack">
      <div className="card stack">
        <label className="f">
          <span>Add a favourite — any stock (NSE or US), XAU, forex pair or coin</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try: TCS, Apple, TSLA, gold, EURUSD, BTC…" autoComplete="off" autoCapitalize="characters" enterKeyHint="search" />
        </label>
        {searching && <p className="small muted">Searching…</p>}
        {!!hits.length && (
          <ul className="fav-hits">
            {hits.map((h) => (
              <li key={`${h.market}:${h.symbol}:${h.name}`}>
                <div><b>{h.symbol}</b> <span className="small muted">{h.name}</span><div className="small muted">{KIND[h.market as Fav["market"]] ?? h.kind}{h.kind && h.market !== "FX" && h.market !== "CRYPTO" ? ` · ${h.kind}` : h.market === "FX" ? ` · ${h.kind}` : ""}</div></div>
                {has(h) ? (
                  <span className="pill good">★ Added</span>
                ) : (
                  <button className="btn small primary" disabled={busy} onClick={() => start(async () => { const r = await addFavourite(h.symbol, h.market); setMsg(r); if (r?.ok) setQ(""); })}>☆ Add</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {msg && <p className={`small ${msg.ok ? "up" : "down"}`}>{msg.message}</p>}
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Your favourites ({favs.length})</h3>
          <span className="small muted">The first three show as charts on the dashboard</span>
        </div>
        {!favs.length && <p className="small muted">Nothing yet — search above, or tap ☆ on any stock, XAU/forex or crypto page.</p>}
        <ol className="fav-order">
          {favs.map((f, i) => (
            <li key={`${f.market}:${f.symbol}`} className={i < 3 ? "top3" : ""}>
              <span className="rank">{i + 1}</span>
              <Link href={href(f)} className="fav-order-name">
                <b>{f.symbol}</b>
                <span className="small muted">{f.name ?? ""} · {KIND[f.market]}</span>
              </Link>
              {i < 3 && <span className="pill confirmed hide-xs">chart</span>}
              <div className="fav-order-btns">
                <button className="btn small" disabled={busy || i === 0} aria-label={`Move ${f.symbol} up`} onClick={() => start(() => moveFavourite(f.symbol, f.market, -1))}>↑</button>
                <button className="btn small" disabled={busy || i === favs.length - 1} aria-label={`Move ${f.symbol} down`} onClick={() => start(() => moveFavourite(f.symbol, f.market, 1))}>↓</button>
                <button className="btn small danger" disabled={busy} aria-label={`Remove ${f.symbol}`} onClick={() => start(async () => { await removeFavourite(f.symbol, f.market); setMsg({ ok: true, message: `${f.symbol} removed.` }); })}>✕</button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
