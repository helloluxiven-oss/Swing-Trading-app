import { focus52 } from "@/lib/focus52";
import Link from "next/link";
import { analyseOne, chartBars } from "@/lib/scan";
import { ema } from "@/lib/indicators";
import { scoreRules, exitWatch, tradeable } from "@/lib/score";
import { STATUS_LABEL } from "@/lib/setup";
import { money, pct, qtyFmt, tone, ago } from "@/lib/format";
import type { Stock } from "@/lib/universe";
import type { Holding, Trade } from "@/lib/data";
import Chart from "./Chart";
import StarButton from "./StarButton";
import RuleDots from "./RuleDots";
import Logo from "@/components/Logo";

/** One favourite, in depth: live chart, where it stands on your rules, and your position in it. */
export default async function FocusCard({ stock, holdings, trades }: { stock: Stock; holdings: Holding[]; trades: Trade[] }) {
  const live = await analyseOne(stock);
  const { quote: q, candles, analysis: a } = live;
  if (!q || !a) {
    return <div className="card"><b>{stock.symbol}</b> <span className="muted">— no market data right now.</span></div>;
  }
  const m = stock.market;
  const held = holdings.filter((h) => h.symbol === stock.symbol && h.market === m);
  const qty = held.reduce((s, h) => s + h.qty, 0);
  const avg = qty ? held.reduce((s, h) => s + h.qty * h.avg_price, 0) / qty : null;
  const gain = avg === null ? null : (q.price - avg) * qty;
  const gainPct = avg === null ? null : ((q.price - avg) / avg) * 100;
  const openTrade = trades.find((t) => t.status === "open" && t.symbol === stock.symbol && t.market === m) ?? null;
  const watchSide = openTrade?.side ?? "long";
  const signals = qty || openTrade ? exitWatch(a, watchSide) : [];
  const bars = chartBars(candles, live.forming, q);
  const closes = bars.map((c) => c.c);
  const score = scoreRules(a.best.rules);
  const cur = m === "IN" ? "₹" : "$";
  const pos = Math.round(a.rangePos * 100);
  const f52 = focus52(a.last.c, a.low52, a.high52, a.ema50);

  return (
    <section className="focus card">
      <div className="focus-head">
        <div className="row">
          <Logo symbol={stock.symbol} market={stock.market} size={48} />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h2 style={{ margin: 0 }}>{stock.symbol}</h2>
              <StarButton symbol={stock.symbol} market={m} starred />
              <span className="pill">{m === "IN" ? "NSE" : "US"}</span>
            </div>
            <div className="small muted">{stock.name} · {q.marketOpen ? "market open" : "market closed"} · {ago(q.time)}</div>
          </div>
        </div>
        <div className="focus-price">
          <div className="big">{money(q.price, m)}</div>
          <div className={tone(q.changePct)}>{money(q.change, m)} ({pct(q.changePct)})</div>
        </div>
      </div>

      <Chart bars={bars} ema20={ema(closes, 20)} ema50={ema(closes, 50)} avgCost={avg} levels={openTrade ? { entry: openTrade.entry, stop: openTrade.stop, target: openTrade.target } : null} height={340} defaultRange="3M" currency={cur} symbol={stock.symbol} />

      <div className="grid g4 focus-stats">
        <div>
          <div className="label">Your setup</div>
          <div className="row" style={{ gap: 6 }}>
            <span className={`pill ${a.best.status}`}>{tradeable(a.best.status) ? "⚡ " : ""}{STATUS_LABEL[a.best.status]}</span>
            <span className={`pill ${a.best.side}`}>{a.best.side}</span>
          </div>
          <div className="row" style={{ marginTop: 6 }}><RuleDots rules={a.best.rules} /><span className="small muted">{score}/100</span></div>
        </div>
        <div>
          <div className="label">Trend</div>
          <div className="small">20 EMA <b>{money(a.ema20, m)}</b> <span className={tone(a.last.c - a.ema20)}>({pct(((a.last.c - a.ema20) / a.ema20) * 100, 1)})</span></div>
          <div className="small">50 EMA <b>{money(a.ema50, m)}</b> <span className={tone(a.last.c - a.ema50)}>({pct(((a.last.c - a.ema50) / a.ema50) * 100, 1)})</span></div>
          <div className="small">RSI <b>{a.rsi.toFixed(1)}</b> · ATR <b>{money(a.atr14, m)}</b></div>
        </div>
        <div>
          <div className="label">52-week range</div>
          <div className="range"><i style={{ left: `${pos}%` }} /></div>
          <div className="small muted row between"><span>{money(a.low52, m, 0)}</span><span>{pos}%</span><span>{money(a.high52, m, 0)}</span></div>
          {f52.focus !== "NEUTRAL" && (
            <span className={`pill ${f52.focus === "BUY FOCUS" ? "good" : "bad"}`} title={f52.note} style={{ marginTop: 6 }}>
              {f52.focus}{f52.trendAgrees === false ? " · against trend" : ""}
            </span>
          )}
        </div>
        <div>
          <div className="label">Your position</div>
          {qty ? (
            <>
              <div className={`big-num ${tone(gain)}`}>{money(gain, m)} <span className="small">{pct(gainPct)}</span></div>
              <div className="small muted">{qtyFmt(qty)} @ {money(avg, m)} · value {money(qty * q.price, m)}</div>
            </>
          ) : openTrade ? (
            <div className="small">Open {openTrade.side} from {money(openTrade.entry, m)}</div>
          ) : (
            <div className="small muted">Not held. <Link href="/portfolio" className="up">Add it</Link></div>
          )}
        </div>
      </div>

      {!!signals.length && (
        <div className="stack">
          {signals.map((s) => (
            <div key={s.text} className={`note small ${s.level === "ok" ? "good" : s.level === "caution" ? "warn" : "bad"}`}>
              <b>{s.level === "take-profit" ? "Take-profit zone" : s.level === "broken" ? "Trend broken" : s.level === "caution" ? "Caution" : "Holding up"}</b> — {s.text}
            </div>
          ))}
          <div className="small muted">Trailing stop idea: the 10-day swing low at <b>{money(a.swingLow, m)}</b>. Your rules decide — this only shows where it is.</div>
        </div>
      )}

      <div className="row between">
        <span className="small muted">Yellow line = your average cost. Purple/cyan = 20/50 EMA.</span>
        <Link href={`/stock/${m}/${encodeURIComponent(stock.symbol)}`} className="btn small">Full analysis & trade plan →</Link>
      </div>
    </section>
  );
}
