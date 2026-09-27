import Link from "next/link";
import { getHoldings } from "@/lib/data";
import { getSeries, mapLimit, usdInr } from "@/lib/market";
import { analyse } from "@/lib/setup";
import { exitWatch } from "@/lib/score";
import { focus52 } from "@/lib/focus52";
import { INDEX } from "@/lib/universe";
import { portfolioHistory } from "@/lib/portfolio";
import { money, pct, qtyFmt, tone } from "@/lib/format";
import { importSheetHoldings, removeHolding } from "../actions";
import AddHolding from "@/components/AddHolding";
import AutoRefresh from "@/components/AutoRefresh";
import PortfolioChart from "@/components/PortfolioChart";
import Donut, { PALETTE } from "@/components/Donut";
import Sparkline from "@/components/Sparkline";

export const dynamic = "force-dynamic";

const inr = (x: number | null) => money(x, "IN", 0);

export default async function PortfolioPage() {
  const [holdings, fx, benchIN, benchUS] = await Promise.all([
    getHoldings(),
    usdInr(),
    getSeries(INDEX.IN.symbol, "IN", 300, "2y"),
    getSeries(INDEX.US.symbol, "US", 300, "2y"),
  ]);
  const series = await mapLimit(holdings, 6, (h) => getSeries(h.symbol, h.market, 60, "2y"));

  const rows = holdings.map((h, i) => {
    const s = series[i];
    const rate = h.market === "IN" ? 1 : fx;
    const price = s?.quote.price ?? null;
    const cost = h.qty * h.avg_price;
    const value = price === null ? null : h.qty * price;
    const gain = value === null ? null : value - cost;
    const a = s ? analyse(s.candles) : null;
    const since = h.bought_on ? Date.parse(h.bought_on) / 1000 : 0;
    const spark = (s?.candles ?? []).filter((c) => c.t >= since).map((c) => c.c);
    return {
      h, s, a, price, cost, value, gain, rate,
      gainPct: gain === null ? null : (gain / cost) * 100,
      dayPct: s?.quote.changePct ?? null,
      dayInr: s && rate ? h.qty * s.quote.change * rate : null,
      valueInr: value !== null && rate ? value * rate : null,
      costInr: rate ? cost * rate : null,
      spark: spark.length > 1 ? spark : (s?.candles ?? []).slice(-60).map((c) => c.c),
      exit: a ? exitWatch(a, "long") : [],
      f52: a ? focus52(a.last.c, a.low52, a.high52, a.ema50) : null,
    };
  });

  const complete = rows.every((r) => r.valueInr !== null && r.costInr !== null);
  const value = complete ? rows.reduce((t, r) => t + r.valueInr!, 0) : null;
  const cost = complete ? rows.reduce((t, r) => t + r.costInr!, 0) : null;
  const gain = value !== null && cost !== null ? value - cost : null;
  const day = rows.every((r) => r.dayInr !== null) ? rows.reduce((t, r) => t + r.dayInr!, 0) : null;

  const history =
    fx && complete
      ? portfolioHistory(
          rows.map((r) => ({
            qty: r.h.qty,
            avg: r.h.avg_price,
            boughtOn: r.h.bought_on ? Date.parse(r.h.bought_on) / 1000 : null,
            fx: r.h.market === "IN" ? 1 : fx,
            candles: r.s?.candles ?? [],
            bench: (r.h.market === "IN" ? benchIN : benchUS)?.candles ?? [],
          })),
        )
      : [];
  const last = history.at(-1);
  const vsIndex = last ? last.value - last.bench : null;
  const worstPL = history.length ? Math.min(0, ...history.map((p) => p.value - p.invested)) : null;

  const byStock = [...rows].sort((a, b) => (b.valueInr ?? 0) - (a.valueInr ?? 0)).map((r) => ({ label: r.h.symbol, value: r.valueInr ?? 0 }));
  const sectors = new Map<string, number>();
  rows.forEach((r) => sectors.set(r.h.sector ?? (r.h.market === "IN" ? "India" : "US"), (sectors.get(r.h.sector ?? (r.h.market === "IN" ? "India" : "US")) ?? 0) + (r.valueInr ?? 0)));
  const bySector = [...sectors].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, value: v }));
  const topSector = bySector[0];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.gainPct ?? 0)));
  const alerts = rows.filter((r) => r.exit.some((e) => e.level !== "ok"));

  return (
    <>
      <section className="hero-today">
        <div className="row between">
          <div>
            <div className="small muted">Portfolio · live · totals in ₹{fx ? ` at USD/INR ${fx.toFixed(2)}` : " (USD/INR unavailable)"}</div>
            <div className="big-num">{inr(value)}</div>
            <div className={`row chips ${tone(gain)}`} style={{ marginTop: 4 }}>
              <b>{gain === null ? "—" : `${gain >= 0 ? "+" : "−"}${inr(Math.abs(gain))}`}</b>
              <span>{cost && gain !== null ? pct((gain / cost) * 100) : ""} all time</span>
              <span className={tone(day)}>· {day === null ? "—" : `${day >= 0 ? "+" : "−"}${inr(Math.abs(day))}`} today</span>
            </div>
          </div>
          <AutoRefresh seconds={30} />
        </div>
      </section>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card tight kpi"><div className="label">Invested</div><div className="val">{inr(cost)}</div></div>
        <div className="card tight kpi">
          <div className="label">vs same money in index</div>
          <div className={`val ${tone(vsIndex)}`}>{vsIndex === null ? "—" : `${vsIndex >= 0 ? "+" : "−"}${inr(Math.abs(vsIndex))}`}</div>
          <div className="small muted">{vsIndex === null ? "" : vsIndex >= 0 ? "your picks are beating the index" : "the index would have done better"}</div>
        </div>
        <div className="card tight kpi"><div className="label">Worst dip in P/L</div><div className="val down">{worstPL === null ? "—" : inr(worstPL)}</div><div className="small muted">lowest point of unrealised P/L</div></div>
        <div className="card tight kpi"><div className="label">Biggest sector</div><div className="val">{topSector ? `${Math.round((topSector.value / (value || 1)) * 100)}%` : "—"}</div><div className="small muted">{topSector?.label ?? ""}{topSector && value && topSector.value / value > 0.5 ? " — concentrated" : ""}</div></div>
      </div>

      {!holdings.length && (
        <form action={importSheetHoldings} className="note" style={{ marginBottom: 16 }}>
          No holdings yet. <button className="btn small" style={{ marginLeft: 8 }}>Import my 4 open positions from the sheet (KO, MSFT, NVDA, ADBE)</button>
        </form>
      )}

      {!!holdings.length && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Value over time</h2>
              <span className="small muted">Current holdings from their buy dates · US in ₹ at today&apos;s rate</span>
            </div>
            <PortfolioChart points={history} />
          </div>

          <div className="grid g3" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3 className="card-title">Allocation</h3>
              <Donut parts={byStock} center={<><b>{rows.length}</b><span className="small muted">stocks</span></>} />
            </div>
            <div className="card">
              <h3 className="card-title">By sector</h3>
              <Donut parts={bySector} center={<><b>{bySector.length}</b><span className="small muted">sectors</span></>} />
            </div>
            <div className="card">
              <h3 className="card-title">Return by holding</h3>
              <ul className="pnl-bars">
                {[...rows].sort((a, b) => (b.gainPct ?? 0) - (a.gainPct ?? 0)).map((r) => (
                  <li key={r.h.id}>
                    <span>{r.h.symbol}</span>
                    <span className="pnl-track">
                      <i className={(r.gainPct ?? 0) >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(r.gainPct ?? 0) / maxAbs) * 50}%` }} />
                    </span>
                    <b className={tone(r.gainPct)}>{pct(r.gainPct, 1)}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {!!alerts.length && (
            <div className="note warn" style={{ marginBottom: 16 }}>
              <b>Exit watch:</b>{" "}
              {alerts.map((r) => `${r.h.symbol} — ${r.exit.filter((e) => e.level !== "ok").map((e) => e.level.replace("-", " ")).join(", ")}`).join(" · ")}
            </div>
          )}

          <h2 className="section-title">Holdings</h2>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            {rows.map((r, i) => {
              const worst = r.exit.find((e) => e.level === "broken") ?? r.exit.find((e) => e.level === "take-profit") ?? r.exit.find((e) => e.level === "caution") ?? r.exit[0];
              const weight = value && r.valueInr ? (r.valueInr / value) * 100 : null;
              return (
                <div key={r.h.id} className="card holding" style={{ borderTop: `3px solid ${PALETTE[byStock.findIndex((b) => b.label === r.h.symbol) % PALETTE.length] ?? PALETTE[i]}` }}>
                  <div className="row between">
                    <div>
                      <Link href={`/stock/${r.h.market}/${encodeURIComponent(r.h.symbol)}`}><b style={{ fontSize: 17 }}>{r.h.symbol}</b></Link>
                      <div className="small muted">{r.h.sector ?? r.h.market} · {qtyFmt(r.h.qty)} @ {money(r.h.avg_price, r.h.market)}{r.h.bought_on ? ` · since ${r.h.bought_on}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <b>{money(r.price, r.h.market)}</b>
                      <div className={`small ${tone(r.dayPct)}`}>{pct(r.dayPct)} today</div>
                    </div>
                  </div>
                  <Sparkline values={r.spark} width={520} height={70} strokeWidth={2} />
                  <div className="row between">
                    <div>
                      <div className={`holding-gain ${tone(r.gain)}`}>{r.gain === null ? "—" : `${r.gain >= 0 ? "+" : "−"}${money(Math.abs(r.gain), r.h.market)}`} <span className="small">{pct(r.gainPct)}</span></div>
                      <div className="small muted">Value {money(r.value, r.h.market)}{weight !== null ? ` · ${weight.toFixed(1)}% of portfolio` : ""}</div>
                    </div>
                    <form action={removeHolding}><input type="hidden" name="id" value={r.h.id} /><button className="btn small danger" title="Remove holding">✕</button></form>
                  </div>
                  <div className="row chips">
                    {worst && <span className={`pill ${worst.level === "ok" ? "good" : worst.level === "caution" ? "watch" : "bad"}`}>{worst.level === "ok" ? "Trend intact" : worst.level === "take-profit" ? "Take profit zone" : worst.level === "broken" ? "Trend broken" : "Caution"}</span>}
                    {r.f52 && r.f52.focus !== "NEUTRAL" && <span className={`pill ${r.f52.focus === "BUY FOCUS" ? "good" : "bad"}`}>52w {r.f52.focus.toLowerCase()}</span>}
                    {r.a && <span className="pill">RSI {r.a.rsi.toFixed(0)}</span>}
                    {r.f52 && <span className="pill">{Math.round(r.f52.rangePos * 100)}% of 52w range</span>}
                  </div>
                  {worst && worst.level !== "ok" && <div className="small muted">{worst.text}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
      <AddHolding />
    </>
  );
}
