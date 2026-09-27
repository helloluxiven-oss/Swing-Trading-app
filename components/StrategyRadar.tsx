import Link from "next/link";
import Sparkline from "./Sparkline";
import { Badge } from "./Favourites";
import { candles } from "@/lib/feeds";
import { analyseLiquidity, nyDesk, prevDayClose } from "@/lib/liquidity";
import { DESKS, deskInstruments, fmtPrice, type DeskKind, type Instrument } from "@/lib/instruments";
import { pct, tone } from "@/lib/format";

type Row = {
  inst: Instrument;
  price: number;
  changePct: number | null;
  spark: number[];
  label: string;
  cls: string;
  grade: string | null;
  headline: string;
  rank: number;
  when: number; // time of the latest event, for "most recent first" among equals
};

// How far along your strategy each stage is. Higher = closer to a trade.
const STAGE: Record<string, [number, string, string]> = {
  ready: [100, "⚡ Setup ready", "confirmed"],
  triggered: [95, "In the trade", "confirmed"],
  reclaimed: [70, "Reclaimed · wait for shift", "watch"],
  testing: [55, "Sweeping now", "watch"],
  swept: [50, "Swept · not reclaimed", "watch"],
  waiting: [20, "Waiting for a sweep", "none"],
  breakout: [12, "Breakout — don't fade", "bad"],
  both: [8, "Both sides taken", "bad"],
  done: [6, "Played out", "none"],
  invalidated: [4, "Failed", "bad"],
  "no-data": [0, "No data", "none"],
};

async function read(inst: Instrument, now: number): Promise<Row | null> {
  const feed = await candles(inst, "5m");
  const cs = feed?.candles;
  if (!feed || !cs || cs.length < 40) return null;
  const d = nyDesk(cs, { now, precision: inst.precision });
  const r = analyseLiquidity(cs, { now, precision: inst.precision });
  const ny = d && (d.phase === "live" || (d.phase === "after" && d.events.length)) ? d : null;
  const ev = ny?.primary ?? null;
  const stage = ev?.status ?? r?.stage ?? "no-data";
  const [base, label, cls] = STAGE[stage] ?? STAGE["no-data"];
  // While waiting: rank by how close price is to the nearest untouched pool (in ATRs).
  let closeness = 0;
  if (stage === "waiting" && d && r?.atr) {
    const resting = d.pools.filter((p) => !p.takenBeforeNY && !d.events.some((e) => e.pools.includes(p.name)));
    const dist = Math.min(...resting.map((p) => Math.abs(p.price - feed.price)));
    if (Number.isFinite(dist)) closeness = Math.max(0, 15 - dist / r.atr); // within 15 ATR scores up to 15
  }
  const pc = prevDayClose(cs);
  const when = ev ? cs[ev.mssI ?? ev.sI].t : r?.sweep ? cs[r.sweep.i].t : 0;
  return {
    inst,
    price: feed.price,
    changePct: pc ? ((feed.price - pc) / pc) * 100 : null,
    spark: cs.slice(-96).map((c) => c.c),
    label: ev ? `${label} · ${ev.grade}` : label,
    cls,
    grade: ev?.grade ?? null,
    headline: ny ? ny.headline : r?.headline ?? "",
    rank: base + (ev ? ev.score / 10 : 0) + closeness,
    when,
  };
}

async function top(kind: DeskKind, n = 5) {
  const now = Math.floor(Date.now() / 1000);
  const rows = (await Promise.all(deskInstruments(kind).map((i) => read(i, now)))).filter((r): r is Row => !!r);
  return rows.sort((a, b) => b.rank - a.rank || b.when - a.when).slice(0, n);
}

function Board({ kind, rows }: { kind: DeskKind; rows: Row[] }) {
  const live = rows.filter((r) => r.cls === "confirmed").length;
  return (
    <div className="card radar">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h3 style={{ margin: 0 }}>{kind === "fx" ? "Forex & commodities" : "Crypto"} · top 5</h3>
          <div className="small muted">{live ? `${live} setup${live > 1 ? "s" : ""} ready` : "Ranked by how close each is to your sweep setup"}</div>
        </div>
        <Link href={DESKS[kind].path} className="small">All {kind === "fx" ? "forex" : "crypto"} →</Link>
      </div>
      <ol className="radar-list">
        {rows.map((r, i) => (
          <li key={r.inst.id}>
            <Link href={`${DESKS[kind].path}?s=${r.inst.id}`} className={`radar-row ${r.cls === "confirmed" ? "hot" : ""}`}>
              <span className="rank">{i + 1}</span>
              <Badge inst={r.inst} />
              <span className="who">
                <b>{r.inst.short}</b>
                <span className="small muted">{r.headline}</span>
              </span>
              <span className="hide-xs"><Sparkline values={r.spark} width={90} height={28} /></span>
              <span className="px">
                <b>{fmtPrice(r.inst, r.price)}</b>
                <span className={`small ${tone(r.changePct)}`}>{pct(r.changePct)}</span>
              </span>
              <span className={`pill ${r.cls} radar-pill`}>{r.label}</span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="small muted" style={{ padding: 12 }}>Prices unavailable right now.</li>}
      </ol>
    </div>
  );
}

/** Top 5 forex/commodities and top 5 crypto, ranked by your liquidity-sweep strategy. */
export default async function StrategyRadar() {
  const [fx, crypto] = await Promise.all([top("fx"), top("crypto")]);
  return (
    <section style={{ marginTop: 18 }}>
      <h2 className="section-title">⚡ Liquidity-sweep radar</h2>
      <div className="grid g2">
        <Board kind="fx" rows={fx} />
        <Board kind="crypto" rows={crypto} />
      </div>
    </section>
  );
}
