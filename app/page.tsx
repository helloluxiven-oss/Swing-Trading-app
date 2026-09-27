import Link from "next/link";
import { Suspense } from "react";
import { scanMarket, type MarketScan, type Row } from "@/lib/scan";
import { getSettings, getWatchlist, recentClosed } from "@/lib/data";
import { inOfficeHours, lossStreak } from "@/lib/gate";
import { rank, scoreRules, tradeable } from "@/lib/score";
import { focus52 } from "@/lib/focus52";
import { money, pct, tone } from "@/lib/format";
import TopList, { type MarketTop, type TopRow } from "@/components/TopList";
import Favourites from "@/components/Favourites";
import type { Watch } from "@/lib/data";
import AreaChart from "@/components/AreaChart";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function toTop(r: Row, starred: Set<string>): TopRow {
  const a = r.analysis!;
  return {
    symbol: r.stock.symbol,
    name: r.stock.name,
    market: r.stock.market,
    price: r.quote?.price ?? a.last.c,
    changePct: r.quote?.changePct ?? null,
    status: a.best.status,
    side: a.best.side,
    score: scoreRules(a.best.rules),
    rs: a.indexRet63 === null ? null : a.ret63 - a.indexRet63,
    rsi: a.rsi,
    tradeable: tradeable(a.best.status),
    starred: starred.has(`${r.stock.market}:${r.stock.symbol}`),
    patterns: a.patterns.map((p) => p.name),
    spark: r.spark,
    sparkT: r.sparkT,
    rules: a.best.rules,
    f52: focus52(a.last.c, a.low52, a.high52, a.ema50),
  };
}

function marketTop(s: MarketScan, starred: Set<string>): MarketTop {
  const withData = s.rows.filter((r) => r.analysis);
  const ext = (x: TopRow) => (x.f52.focus === "BUY FOCUS" ? x.f52.rangePos : 1 - x.f52.rangePos);
  const positional = withData
    .map((r) => toTop(r, starred))
    .filter((r) => r.f52.focus !== "NEUTRAL")
    // trend-agreeing first, then the ones deepest in their zone
    .sort((a, b) => Number(b.f52.trendAgrees === true) - Number(a.f52.trendAgrees === true) || ext(a) - ext(b))
    .slice(0, 10);
  return {
    market: s.market,
    indexName: s.index.name,
    filter: s.index.ctx === null ? null : s.index.ctx.above50 ? "long" : "short",
    rows: rank(withData, 10).map((r) => toTop(r, starred)),
    positional,
  };
}

function Pulse({ s }: { s: MarketScan }) {
  const q = s.index.quote;
  const ctx = s.index.ctx;
  let ready = 0;
  let watch = 0;
  for (const r of s.rows) {
    if (!r.analysis) continue;
    if (tradeable(r.analysis.best.status)) ready++;
    else if (r.analysis.best.status === "watch") watch++;
  }
  return (
    <Link href="/scan" className="card pulse">
      <div className="row between">
        <div>
          <div className="small muted">{s.market === "IN" ? "🇮🇳 India" : "🇺🇸 United States"}</div>
          <b style={{ fontSize: 16 }}>{s.index.name}</b>
        </div>
        <div style={{ textAlign: "right" }}>
          <b style={{ fontSize: 18 }}>{q ? q.price.toLocaleString(s.market === "IN" ? "en-IN" : "en-US", { maximumFractionDigits: 2 }) : "—"}</b>
          <div className={`small ${tone(q?.changePct)}`}>{q ? pct(q.changePct) : "unavailable"}</div>
        </div>
      </div>
      <AreaChart t={s.index.sparkT} c={s.index.spark} height={120} />
      <div className="row chips">
        {ctx === null ? <span className="pill none">Filter unknown</span> : ctx.above50 ? <span className="pill good">▲ Uptrend · longs only</span> : <span className="pill bad">▼ Downtrend · shorts only</span>}
        <span className={`pill ${ready ? "confirmed" : ""}`}>⚡ {ready} tradeable</span>
        <span className="pill watch">{watch} on watch</span>
      </div>
    </Link>
  );
}

export default async function Today() {
  const [inScan, usScan, settings, recent, watch] = await Promise.all([
    scanMarket("IN"),
    scanMarket("US"),
    getSettings(),
    recentClosed(),
    getWatchlist(),
  ]);
  // NVDA is pinned until you star your own favourites.
  // Starter favourites until you star your own: your swing (NVDA), gold and bitcoin.
  const favs: Watch[] = watch.length ? watch : [{ symbol: "XAUUSD", market: "FX" }, { symbol: "BTC", market: "CRYPTO" }, { symbol: "NVDA", market: "US" }];
  const starred = new Set(watch.map((w) => `${w.market}:${w.symbol}`));

  const now = new Date();
  const office = inOfficeHours(now, settings);
  const { streak, lastLossToday } = lossStreak(recent, now, settings.timezone);
  const cooling = streak >= settings.maxConsecutiveLosses && lastLossToday;
  const gateOpen = !office && !cooling;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: settings.timezone }).format(now));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const total = [inScan, usScan].reduce((n, s) => n + s.rows.filter((r) => r.analysis && tradeable(r.analysis.best.status)).length, 0);

  return (
    <>
      <section className="hero-today">
        <div className="row between">
          <div>
            <div className="small muted">{hello}</div>
            <h1 style={{ margin: "2px 0 6px" }}>
              {total ? <>{total} setup{total > 1 ? "s" : ""} <em className="serif">ready today</em></> : <>No setups today — <em className="serif">waiting is a position</em></>}
            </h1>
          </div>
          <AutoRefresh seconds={60} />
        </div>
        <div className="row chips">
          <span className={`pill ${gateOpen ? "good" : "bad"}`}>{gateOpen ? "Gate open" : "Gate closed"}</span>
          <span className={`pill ${office ? "watch" : ""}`}>{office ? `Office hours until ${settings.officeEnd}` : "Outside office hours"}</span>
          <span className={`pill ${cooling ? "bad" : ""}`}>{cooling ? `Cool-down: ${streak} losses` : streak ? `${streak} loss${streak > 1 ? "es" : ""} in a row` : "No losing streak"}</span>
          <span className="pill">Risk {settings.riskPct}% · 1:{settings.rr}</span>
        </div>
      </section>

      <Suspense fallback={<div className="card skeleton" style={{ height: 260, marginTop: 18 }} />}>
        <Favourites list={favs} suggested={!watch.length} />
      </Suspense>


      <h2 className="section-title">Markets</h2>
      <div className="grid g2">
        <Pulse s={inScan} />
        <Pulse s={usScan} />
      </div>

      <div style={{ marginTop: 18 }}>
        <TopList data={[marketTop(inScan, starred), marketTop(usScan, starred)]} />
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        Not investment advice. The score counts how many of your rules a stock meets on the last completed daily candle — it is not a prediction.
        NSE prices on the free feed run about 15 minutes behind.
      </p>
    </>
  );
}
