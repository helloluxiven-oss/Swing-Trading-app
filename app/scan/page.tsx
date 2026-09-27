import Link from "next/link";
import { scanMarket } from "@/lib/scan";
import { STATUS_LABEL, type Status } from "@/lib/setup";
import RuleDots from "@/components/RuleDots";
import { money, pct, tone, ago } from "@/lib/format";
import type { Market } from "@/lib/plan";

import AutoRefresh from "@/components/AutoRefresh";
import Logo from "@/components/Logo";

export const dynamic = "force-dynamic";

const RANK: Record<Status, number> = { confirmed: 3, ready: 2, watch: 1, none: 0 };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ m?: string; f?: string }> }) {
  const sp = await searchParams;
  const market: Market = sp.m === "US" ? "US" : "IN";
  const filter = sp.f === "all" ? "all" : "setups";
  const scan = await scanMarket(market);

  const rows = scan.rows
    .filter((r) => r.analysis)
    .sort((a, b) => {
      const d = RANK[b.analysis!.best.status] - RANK[a.analysis!.best.status];
      if (d) return d;
      const rs = (x: typeof a) => x.analysis!.ret63 - (x.analysis!.indexRet63 ?? 0);
      return rs(b) - rs(a);
    });
  const shown = filter === "all" ? rows : rows.filter((r) => r.analysis!.best.status !== "none");
  const missing = scan.rows.filter((r) => !r.analysis).map((r) => r.stock.symbol);
  const counts = (["confirmed", "ready", "watch"] as Status[]).map((s) => [s, rows.filter((r) => r.analysis!.best.status === s).length] as const);
  const q = scan.index.quote;

  const href = (m: Market, f: string) => `/scan?m=${m}&f=${f}`;
  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="row"><h1>Stocks</h1><AutoRefresh seconds={60} /></div>
        <div className="row">
          <div className="seg">
            <Link className={market === "IN" ? "on" : ""} href={href("IN", filter)}>India · NIFTY 50</Link>
            <Link className={market === "US" ? "on" : ""} href={href("US", filter)}>US · Dow 30 + holdings</Link>
          </div>
          <div className="seg">
            <Link className={filter === "setups" ? "on" : ""} href={href(market, "setups")}>Setups only</Link>
            <Link className={filter === "all" ? "on" : ""} href={href(market, "all")}>All</Link>
          </div>
        </div>
      </div>
      <p className="sub">
        Daily candles, last completed session. Rules in order: trend · pullback · RSI · candle · market ·
        volume · relative strength. The first five decide a setup.
      </p>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card tight kpi">
          <div className="label">{scan.index.name}</div>
          <div className="val">{q ? money(q.price, market) : "—"}</div>
          <div className={`small ${tone(q?.changePct)}`}>{q ? pct(q.changePct) : "unavailable"}</div>
        </div>
        <div className="card tight kpi">
          <div className="label">Market filter</div>
          <div className="val" style={{ fontSize: 17 }}>
            {scan.index.ctx === null ? (
              <span className="pill none">Unknown</span>
            ) : scan.index.ctx.above50 ? (
              <span className="pill good">Longs only</span>
            ) : (
              <span className="pill bad">Shorts only</span>
            )}
          </div>
          <div className="small muted">Index vs its 50 EMA</div>
        </div>
        {counts.slice(0, 2).map(([s, n]) => (
          <div key={s} className="card tight kpi">
            <div className="label">{STATUS_LABEL[s]}</div>
            <div className="val">{n}</div>
            <div className="small muted">{s === "confirmed" ? "all 7 rules" : "5 required rules"}</div>
          </div>
        ))}
      </div>

      <div className="card scroll" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Stock</th>
              <th className="num">Price</th>
              <th className="num">Day</th>
              <th>Status</th>
              <th>Rules</th>
              <th className="num hide-sm">RSI</th>
              <th className="num hide-sm">vs 20 EMA</th>
              <th className="num hide-sm">vs index 3m</th>
              <th className="hide-sm">Pattern</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ stock, quote, analysis: a }) => {
              const best = a!.best;
              const rs = a!.indexRet63 === null ? null : a!.ret63 - a!.indexRet63;
              return (
                <tr key={stock.symbol}>
                  <td>
                    <Link href={`/stock/${market}/${encodeURIComponent(stock.symbol)}`} className="who-wrap">
                      <Logo symbol={stock.symbol} market={market} size={30} />
                      <span><b>{stock.symbol}</b><div className="small muted">{stock.name}</div></span>
                    </Link>
                  </td>
                  <td className="num">{quote ? money(quote.price, market) : "—"}</td>
                  <td className={`num ${tone(quote?.changePct)}`}>{quote ? pct(quote.changePct) : "—"}</td>
                  <td>
                    <span className={`pill ${best.status}`}>{STATUS_LABEL[best.status]}</span>{" "}
                    {best.status !== "none" && <span className={`pill ${best.side}`}>{best.side}</span>}
                  </td>
                  <td><RuleDots rules={best.rules} /></td>
                  <td className="num hide-sm">{a!.rsi.toFixed(1)}</td>
                  <td className="num hide-sm">{pct(((a!.last.c - a!.ema20) / a!.ema20) * 100, 1)}</td>
                  <td className={`num hide-sm ${tone(rs)}`}>{rs === null ? "—" : `${rs >= 0 ? "+" : ""}${rs.toFixed(1)} pts`}</td>
                  <td className="hide-sm small">{a!.patterns.map((p) => p.name).join(", ") || <span className="muted">—</span>}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={9} className="muted" style={{ padding: 24, textAlign: "center" }}>
                  No stock meets your trend and pullback rules today. Waiting is a position.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        {q ? `Index quote ${ago(q.time)}. ` : ""}
        {market === "IN" ? "NSE prices on free feeds run about 15 minutes behind. " : ""}
        {missing.length ? `No data right now for: ${missing.join(", ")}.` : ""}
      </p>
    </>
  );
}
