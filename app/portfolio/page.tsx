import Link from "next/link";
import { getHoldings } from "@/lib/data";
import { getSeries, mapLimit, usdInr } from "@/lib/market";
import { ema } from "@/lib/indicators";
import { money, pct, qtyFmt, tone } from "@/lib/format";
import { importSheetHoldings, removeHolding } from "../actions";
import AddHolding from "@/components/AddHolding";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const [holdings, fx] = await Promise.all([getHoldings(), usdInr()]);
  const live = await mapLimit(holdings, 6, async (h) => {
    const s = await getSeries(h.symbol, h.market, 120);
    if (!s) return null;
    const e50 = ema(s.candles.map((c) => c.c), 50).at(-1) ?? null;
    return { price: s.quote.price, dayPct: s.quote.changePct, above50: e50 === null ? null : s.quote.price > e50 };
  });

  const rows = holdings.map((h, i) => {
    const l = live[i];
    const cost = h.qty * h.avg_price;
    const value = l ? h.qty * l.price : null;
    const gain = value === null ? null : value - cost;
    return { h, l, cost, value, gain, gainPct: gain === null ? null : (gain / cost) * 100 };
  });
  const toInr = (x: number, m: "IN" | "US") => (m === "IN" ? x : fx ? x * fx : null);
  const sumInr = (k: "cost" | "value") => {
    let t = 0;
    for (const r of rows) {
      const v = r[k];
      if (v === null) return null;
      const inr = toInr(v, r.h.market);
      if (inr === null) return null;
      t += inr;
    }
    return t;
  };
  const cost = sumInr("cost");
  const value = sumInr("value");
  const gain = cost !== null && value !== null ? value - cost : null;

  return (
    <>
      <h1>Portfolio</h1>
      <p className="sub">Live value of what you hold. Totals in rupees at today&apos;s USD/INR{fx ? ` (${fx.toFixed(2)})` : " — rate unavailable"}.</p>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card tight kpi"><div className="label">Invested</div><div className="val">{money(cost, "IN", 0)}</div></div>
        <div className="card tight kpi"><div className="label">Current value</div><div className="val">{money(value, "IN", 0)}</div></div>
        <div className="card tight kpi"><div className="label">Unrealised</div><div className={`val ${tone(gain)}`}>{money(gain, "IN", 0)}</div><div className={`small ${tone(gain)}`}>{cost ? pct(((gain ?? 0) / cost) * 100) : ""}</div></div>
      </div>

      {!holdings.length && (
        <form action={importSheetHoldings} className="note" style={{ marginBottom: 16 }}>
          No holdings yet. <button className="btn small" style={{ marginLeft: 8 }}>Import my 4 open positions from the sheet (KO, MSFT, NVDA, ADBE)</button>
        </form>
      )}

      {!!holdings.length && (
        <div className="card scroll" style={{ padding: 0, marginBottom: 16 }}>
          <table className="tbl">
            <thead>
              <tr><th>Stock</th><th className="num">Qty</th><th className="num">Avg</th><th className="num">Price</th><th className="num">Day</th><th className="num">Value</th><th className="num">Gain</th><th>Trend</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(({ h, l, value, gain, gainPct }) => (
                <tr key={h.id}>
                  <td><Link href={`/stock/${h.market}/${encodeURIComponent(h.symbol)}`}><b>{h.symbol}</b></Link><div className="small muted">{h.sector ?? h.market}</div></td>
                  <td className="num">{qtyFmt(h.qty)}</td>
                  <td className="num">{money(h.avg_price, h.market)}</td>
                  <td className="num">{l ? money(l.price, h.market) : "—"}</td>
                  <td className={`num ${tone(l?.dayPct)}`}>{l ? pct(l.dayPct) : "—"}</td>
                  <td className="num">{money(value, h.market)}</td>
                  <td className={`num ${tone(gain)}`}>{money(gain, h.market)}<div className="small">{pct(gainPct)}</div></td>
                  <td>{l?.above50 == null ? <span className="pill none">—</span> : l.above50 ? <span className="pill good">above 50 EMA</span> : <span className="pill bad">below 50 EMA</span>}</td>
                  <td>
                    <form action={removeHolding}><input type="hidden" name="id" value={h.id} /><button className="btn small danger" title="Remove">✕</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddHolding />
    </>
  );
}
