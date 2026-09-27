"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Sparkline from "./Sparkline";
import AreaChart from "./AreaChart";
import StarButton from "./StarButton";
import { money, pct, tone } from "@/lib/format";
import type { Market } from "@/lib/plan";
import type { Status } from "@/lib/setup";

export type TopRow = {
  symbol: string;
  name: string;
  market: Market;
  price: number | null;
  changePct: number | null;
  status: Status;
  side: "long" | "short";
  score: number;
  rs: number | null;
  rsi: number;
  tradeable: boolean;
  starred: boolean;
  patterns: string[];
  spark: number[];
  sparkT: number[];
  rules: { id: string; label: string; pass: boolean; detail: string }[];
  f52: { focus: "BUY FOCUS" | "SELL FOCUS" | "NEUTRAL"; rangePos: number; trendAgrees: boolean | null; note: string };
};

export type MarketTop = {
  market: Market;
  indexName: string;
  filter: "long" | "short" | null;
  rows: TopRow[];
  positional: TopRow[];
};

const STATUS: Record<Status, string> = { confirmed: "Setup confirmed", ready: "Setup ready", watch: "Watch", none: "No setup" };
const SORTS = [
  ["score", "Closest to setup"],
  ["rs", "Strongest vs index"],
  ["day", "Today's move"],
] as const;

export default function TopList({ data }: { data: MarketTop[] }) {
  const initial = data.find((d) => d.rows.some((r) => r.tradeable))?.market ?? "IN";
  const [m, setM] = useState<Market>(initial);
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("score");
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"swing" | "positional">("swing");
  const cur = data.find((d) => d.market === m)!;

  const rows = useMemo(() => {
    if (view === "positional") return cur.positional;
    const r = [...cur.rows];
    if (sort === "rs") r.sort((a, b) => (b.rs ?? -1e9) - (a.rs ?? -1e9));
    if (sort === "day") r.sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9));
    return r;
  }, [cur, sort, view]);
  const tradeableCount = cur.rows.filter((r) => r.tradeable).length;

  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>{view === "swing" ? "Top 10 swing candidates" : "Positional: 52-week focus"}</h2>
          <div className="small muted">
            {view === "positional"
              ? "Your sheet's rule: bottom 20% of the 52-week range = Buy Focus, top 20% = Sell Focus. Separate from the swing setup."
              : tradeableCount
                ? `${tradeableCount} tradeable today — highlighted. The rest are closest to a setup: wait for them.`
                : "Nothing passes all your required rules today. These are the closest — wait, don't force it."}
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Market">
          {data.map((d) => (
            <button key={d.market} role="tab" aria-selected={m === d.market} className={m === d.market ? "on" : ""} onClick={() => { setM(d.market); setOpen(null); }}>
              {d.market === "IN" ? "🇮🇳 India" : "🇺🇸 US"}
              {d.rows.some((r) => r.tradeable) && <i className="live-dot" />}
            </button>
          ))}
        </div>
      </div>

      <div className="seg view-toggle">
        <button className={view === "swing" ? "on" : ""} onClick={() => { setView("swing"); setOpen(null); }}>⚡ Swing setups</button>
        <button className={view === "positional" ? "on" : ""} onClick={() => { setView("positional"); setOpen(null); }}>🎯 Positional · 52-week focus</button>
      </div>

      <div className="row between small">
        <span className="muted">
          {cur.indexName}:{" "}
          {cur.filter === null ? <b>market filter unknown</b> : cur.filter === "long" ? <b className="up">uptrend — longs only</b> : <b className="down">downtrend — shorts only</b>}
        </span>
        <div className="seg" style={{ visibility: view === "swing" ? "visible" : "hidden" }}>
          {SORTS.map(([k, label]) => (
            <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>
      </div>

      <ol className="toplist">
        {!rows.length && <li className="muted small" style={{ padding: 16 }}>No stock is in its 52-week buy or sell zone right now.</li>}
        {rows.map((r, i) => {
          const isOpen = open === r.symbol;
          return (
            <li key={r.symbol} className={`${r.tradeable ? "hot" : ""} ${isOpen ? "open" : ""}`}>
              <button className="toprow" onClick={() => setOpen(isOpen ? null : r.symbol)} aria-expanded={isOpen}>
                <span className="rank">{i + 1}</span>
                <span className="who">
                  <b>{r.symbol}</b>
                  <span className="small muted">{r.name}</span>
                </span>
                <span className="hide-xs"><Sparkline values={r.spark.slice(-60)} /></span>
                <span className="px">
                  <b>{r.price === null ? "—" : money(r.price, r.market)}</b>
                  <span className={`small ${tone(r.changePct)}`}>{pct(r.changePct)}</span>
                </span>
                <span className="meter" title={`${r.score}/100 of your rules`}>
                  <span className="bar"><i style={{ width: `${r.score}%` }} /></span>
                  <span className="small">{r.score}</span>
                </span>
                <span className="tag">
                  {view === "positional" ? (
                    <span className={`pill ${r.f52.focus === "BUY FOCUS" ? "good" : "bad"}`}>
                      {r.f52.focus}{r.f52.trendAgrees === false ? " · against trend" : r.f52.trendAgrees ? " · trend agrees" : ""}
                    </span>
                  ) : r.tradeable ? <span className={`pill ${r.status}`}>⚡ {STATUS[r.status]} · {r.side}</span> : <span className={`pill ${r.status}`}>{STATUS[r.status]}</span>}
                </span>
              </button>
              {isOpen && (
                <div className="detail">
                  <div className="detail-chart">
                    <AreaChart t={r.sparkT} c={r.spark} height={200} />
                    <div className="small muted">Last 6 months · dashed line = 20-day average</div>
                  </div>
                  {r.f52.focus !== "NEUTRAL" && (
                    <div className={`note small ${r.f52.trendAgrees ? "good" : "warn"}`}>
                      <b>52-week {r.f52.focus.toLowerCase()}</b> ({Math.round(r.f52.rangePos * 100)}% of range) — {r.f52.note}
                    </div>
                  )}
                  <ul className="rules">
                    {r.rules.map((x) => (
                      <li key={x.id}>
                        <span className={`mark ${x.pass ? "ok" : "no"}`}>{x.pass ? "✓" : "✕"}</span>
                        <div><b>{x.label}</b><span>{x.detail}</span></div>
                      </li>
                    ))}
                  </ul>
                  <div className="row between">
                    <span className="small muted">
                      RSI {r.rsi.toFixed(1)} · vs index {r.rs === null ? "—" : `${r.rs >= 0 ? "+" : ""}${r.rs.toFixed(1)} pts`}
                      {r.patterns.length ? ` · ${r.patterns.join(", ")}` : ""}
                    </span>
                    <span className="row">
                      <StarButton symbol={r.symbol} market={r.market} starred={r.starred} />
                      <Link className="btn small primary" href={`/stock/${r.market}/${encodeURIComponent(r.symbol)}`}>
                        {r.tradeable ? "Plan the trade →" : "Open chart →"}
                      </Link>
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
