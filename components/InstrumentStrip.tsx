import Link from "next/link";
import Sparkline from "./Sparkline";
import { DESKS, fmtPrice, type DeskKind, type Instrument } from "@/lib/instruments";
import type { Quote } from "@/lib/feeds";

const ICON: Record<string, string> = { Metals: "◆", Forex: "⇄", Energy: "⛽", Crypto: "₿" };

/** Instrument picker for a desk: the pinned instrument first and larger, the rest scrollable. */
export default function InstrumentStrip({ kind, list, quotes, active, tf }: { kind: DeskKind; list: Instrument[]; quotes: Record<string, Quote>; active: string; tf: string }) {
  const pinned = list.find((i) => i.pinned) ?? list[0];
  const rest = list.filter((i) => i.id !== pinned.id);
  const chip = (i: Instrument, big = false) => {
    const q = quotes[i.id];
    const up = (q?.changePct ?? 0) >= 0;
    return (
      <Link key={i.id} href={`${DESKS[kind].path}?s=${i.id}${tf !== "5m" ? `&tf=${tf}` : ""}`} scroll={false} className={`ichip ${big ? "pinned" : ""} ${active === i.id ? "on" : ""}`} aria-current={active === i.id ? "true" : undefined}>
        <span className="ichip-top">
          <b>{big && <span className="pin">★</span>}{i.short}</b>
          <span className={`small ${q?.changePct == null ? "muted" : up ? "up" : "down"}`}>{q?.changePct == null ? "—" : `${up ? "+" : ""}${q.changePct.toFixed(2)}%`}</span>
        </span>
        <span className="ichip-px">{q ? fmtPrice(i, q.price) : "—"}</span>
        {big && <span className="small muted">{i.name}</span>}
        {q && q.spark.length > 1 && <Sparkline values={q.spark} width={big ? 150 : 84} height={big ? 30 : 20} strokeWidth={1.4} />}
      </Link>
    );
  };
  const groups = [...new Set(rest.map((i) => i.group))];
  return (
    <section className="istrip" aria-label={`${DESKS[kind].title} instruments`}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{DESKS[kind].title}</h1>
        <span className="small muted">{DESKS[kind].blurb} · liquidity-sweep strategy on every chart</span>
      </div>
      <div className="istrip-row">
        {chip(pinned, true)}
        {groups.map((g) => (
          <div key={g} className="igroup">
            <span className="igroup-label">{ICON[g]} {g}</span>
            <div className="igroup-chips">{rest.filter((i) => i.group === g).map((i) => chip(i))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
