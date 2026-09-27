import Link from "next/link";
import { notFound } from "next/navigation";
import { analyseOne, chartBars } from "@/lib/scan";
import { findStock } from "@/lib/universe";
import { ema } from "@/lib/indicators";
import { plan, type Market } from "@/lib/plan";
import { STATUS_LABEL, type SideResult } from "@/lib/setup";
import { getSettings, recentClosed } from "@/lib/data";
import { money, pct, tone, ago } from "@/lib/format";
import Chart from "@/components/Chart";
import TradeGate from "@/components/TradeGate";

import AutoRefresh from "@/components/AutoRefresh";
import Logo from "@/components/Logo";
import { STOCK_TFS, stockIntraday, type StockTf } from "@/lib/market";

export const dynamic = "force-dynamic";

function RuleList({ r }: { r: SideResult }) {
  return (
    <ul className="rules">
      {r.rules.map((x) => (
        <li key={x.id}>
          <span className={`mark ${x.pass ? "ok" : "no"}`}>{x.pass ? "✓" : "✕"}</span>
          <div>
            <b>{x.label}{["volume", "strength"].includes(x.id) ? <span className="muted small"> · confirmation</span> : null}</b>
            <span>{x.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TF_RANGES: Record<string, [string, number][]> = {
  "1m": [["30m", 30], ["2H", 120], ["Day", 390]],
  "5m": [["Day", 78], ["2D", 156], ["5D", 390]],
  "1h": [["1W", 35], ["1M", 150], ["3M", 450]],
  "4h": [["1M", 44], ["3M", 130], ["6M", 260]],
};

export default async function StockPage({ params, searchParams }: { params: Promise<{ market: string; symbol: string }>; searchParams: Promise<{ tf?: string }> }) {
  const { market: m, symbol: raw } = await params;
  const { tf: tfRaw } = await searchParams;
  const tf: StockTf = (STOCK_TFS as string[]).includes(tfRaw ?? "") ? (tfRaw as StockTf) : "1d";
  const market: Market = m === "US" ? "US" : "IN";
  const stock = findStock(decodeURIComponent(raw), market);
  if (!stock) notFound();

  const [live, settings, recent, intraday] = await Promise.all([
    analyseOne(stock),
    getSettings(),
    recentClosed(),
    tf === "1d" ? Promise.resolve(null) : stockIntraday(stock.symbol, market, tf),
  ]);
  const { quote, candles, analysis: a } = live;

  if (!a || !quote) {
    return (
      <>
        <h1>{stock.symbol}</h1>
        <p className="note warn">No market data for {stock.name} right now. The source may be down, or the symbol may have changed (for example after a demerger).</p>
      </>
    );
  }

  const bars = chartBars(candles, live.forming, quote);
  const closes = bars.map((c) => c.c);
  // Chart timeframe is display-only; the rules below always use daily candles.
  const chartCandles = tf === "1d" || !intraday?.length ? bars : intraday;
  const chartCloses = chartCandles.map((c) => c.c);
  const capital = market === "IN" ? settings.capitalInr : settings.capitalUsd;
  const mk = (side: "long" | "short") =>
    plan({
      side, market, signalHigh: a.last.h, signalLow: a.last.l, swingLow: a.swingLow, swingHigh: a.swingHigh,
      capital, riskPct: settings.riskPct, stopMode: settings.stopMode, fixedStopPct: settings.fixedStopPct,
      atr: a.atr14, atrMult: 1, rr: settings.rr,
    });
  const plans = { long: mk("long"), short: mk("short") };
  const best = a.best;
  const pos = Math.round(a.rangePos * 100);

  return (
    <>
      <div className="row between">
        <div>
          <Link href={`/scan?m=${market}`} className="small muted">← {market === "IN" ? "India" : "US"} scanner</Link>
          <h1 className="who-wrap"><Logo symbol={stock.symbol} market={stock.market} size={44} />{stock.symbol} <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}>{stock.name}</span></h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{money(quote.price, market)}</div>
          <div className={tone(quote.changePct)}>{money(quote.change, market)} ({pct(quote.changePct)})</div>
          <div className="small muted">{quote.marketOpen ? "Market open" : "Market closed"} · quote {ago(quote.time)}</div>
          <div style={{ marginTop: 4 }}><AutoRefresh seconds={30} /></div>
        </div>
      </div>

      <div className="row" style={{ margin: "10px 0 16px" }}>
        <span className={`pill ${best.status}`}>{STATUS_LABEL[best.status]}</span>
        {best.status !== "none" && <span className={`pill ${best.side}`}>{best.side}</span>}
        {a.patterns.map((p) => (
          <span key={p.name} className={`pill ${p.bias === "bullish" ? "good" : p.bias === "bearish" ? "bad" : ""}`}>{p.name}</span>
        ))}
        <span className="small muted">Rules use the last completed daily candle ({new Date(a.last.t * 1000).toISOString().slice(0, 10)}).</span>
      </div>

      {tf !== "1d" && !intraday?.length && <p className="note warn small">No {tf} data from the source right now — showing daily.</p>}
      <div className="card" style={{ padding: 8, marginBottom: 14 }}>
        <Chart
          key={tf}
          bars={chartCandles}
          ema20={ema(chartCloses, 20)}
          ema50={ema(chartCloses, 50)}
          tf={{ current: tf, options: STOCK_TFS, href: `/stock/${market}/${encodeURIComponent(stock.symbol)}` }}
          ranges={tf === "1d" ? undefined : TF_RANGES[tf]}
          defaultRange={tf === "1d" ? "6M" : TF_RANGES[tf][1][0]}
          timeZone={tf === "1d" ? undefined : market === "IN" ? "Asia/Kolkata" : "America/New_York"}
          levels={best.status === "ready" || best.status === "confirmed" ? plans[best.side] : null}
        />
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Long rules</h2>
          <RuleList r={a.long} />
        </div>
        <div className="card">
          <h2>Short rules</h2>
          <RuleList r={a.short} />
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card tight kpi"><div className="label">RSI 14</div><div className="val">{a.rsi.toFixed(1)}</div><div className="small muted">yesterday {a.rsiPrev.toFixed(1)}</div></div>
        <div className="card tight kpi"><div className="label">ATR 14</div><div className="val">{money(a.atr14, market)}</div><div className="small muted">{((a.atr14 / a.last.c) * 100).toFixed(1)}% a day</div></div>
        <div className="card tight kpi"><div className="label">52-week range</div><div className="val">{pos}%</div><div className="small muted">{money(a.low52, market, 0)} – {money(a.high52, market, 0)}</div></div>
        <div className="card tight kpi"><div className="label">vs {live.index.name} (3m)</div><div className={`val ${tone(a.indexRet63 === null ? null : a.ret63 - a.indexRet63)}`}>{a.indexRet63 === null ? "—" : `${(a.ret63 - a.indexRet63).toFixed(1)} pts`}</div><div className="small muted">stock {pct(a.ret63, 1)}</div></div>
      </div>

      <TradeGate
        symbol={stock.symbol}
        market={market}
        defaultSide={best.side}
        sides={{
          long: { status: a.long.status, withTrend: a.long.rules[0].pass, plan: plans.long },
          short: { status: a.short.status, withTrend: a.short.rules[0].pass, plan: plans.short },
        }}
        settings={settings}
        recentClosed={recent}
      />
    </>
  );
}
