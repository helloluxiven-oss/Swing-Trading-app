import Link from "next/link";
import Logo from "./Logo";
import Sparkline from "./Sparkline";
import StarButton from "./StarButton";
import { analyseOne } from "@/lib/scan";
import { candles } from "@/lib/feeds";
import { analyseLiquidity, nyDesk, prevDayClose } from "@/lib/liquidity";
import { DESKS, deskInstruments, fmtPrice, type Instrument } from "@/lib/instruments";
import { findStock } from "@/lib/universe";
import { STATUS_LABEL } from "@/lib/setup";
import { scoreRules, tradeable } from "@/lib/score";
import { money, pct, tone } from "@/lib/format";
import type { Watch } from "@/lib/data";

type Tile = {
  key: string;
  symbol: string;
  name: string;
  kind: "Stock" | "Forex & commodities" | "Crypto";
  market: Watch["market"];
  href: string;
  price: string;
  changePct: number | null;
  spark: number[];
  status: string;
  statusCls: string;
  hint: string;
  hot: boolean;
  logo: React.ReactNode;
  starred: boolean;
};

const BADGE: Record<string, [string, string]> = {
  XAUUSD: ["Au", "linear-gradient(135deg,#f5d77a,#b8860b)"],
  XAGUSD: ["Ag", "linear-gradient(135deg,#e5e7eb,#9ca3af)"],
  USOIL: ["WTI", "linear-gradient(135deg,#374151,#111827)"],
  UKOIL: ["BRN", "linear-gradient(135deg,#374151,#111827)"],
  NATGAS: ["NG", "linear-gradient(135deg,#60a5fa,#1e3a8a)"],
  BTC: ["₿", "linear-gradient(135deg,#f7931a,#c26a00)"],
  ETH: ["Ξ", "linear-gradient(135deg,#8c8cf7,#454a75)"],
  SOL: ["◎", "linear-gradient(135deg,#14f195,#9945ff)"],
  XRP: ["✕", "linear-gradient(135deg,#6b7280,#111827)"],
  BNB: ["B", "linear-gradient(135deg,#f3ba2f,#b8860b)"],
  DOGE: ["Ð", "linear-gradient(135deg,#e1c16e,#a0822e)"],
  ADA: ["₳", "linear-gradient(135deg,#3b82f6,#0033ad)"],
  AVAX: ["A", "linear-gradient(135deg,#f87171,#b91c1c)"],
  LINK: ["⬡", "linear-gradient(135deg,#60a5fa,#2a5ada)"],
  LTC: ["Ł", "linear-gradient(135deg,#cbd5e1,#64748b)"],
};

function Badge({ inst }: { inst: Instrument }) {
  const [text, bg] = BADGE[inst.id] ?? [inst.id.slice(0, 3), "linear-gradient(135deg,#7c3aed,#22d3ee)"];
  return <span className="logo logo-fallback" style={{ width: 36, height: 36, borderRadius: 10, background: bg, fontSize: text.length > 2 ? 10 : 15 }} aria-hidden="true">{text}</span>;
}

const STAGE_TEXT: Record<string, [string, string]> = {
  waiting: ["Waiting for a sweep", "none"],
  swept: ["Swept · not reclaimed", "watch"],
  reclaimed: ["Reclaimed · wait for shift", "watch"],
  ready: ["⚡ Setup ready", "confirmed"],
  triggered: ["In the trade", "confirmed"],
  invalidated: ["Invalidated", "bad"],
  done: ["Played out", "none"],
  both: ["Both sides taken", "bad"],
  "no-data": ["No data", "none"],
  testing: ["Testing beyond", "watch"],
  breakout: ["Breakout", "bad"],
};

async function stockTile(w: Watch, starred: boolean): Promise<Tile | null> {
  if (w.market !== "IN" && w.market !== "US") return null;
  const stock = findStock(w.symbol, w.market);
  if (!stock) return null;
  const live = await analyseOne(stock);
  const a = live.analysis;
  const q = live.quote;
  const st = a?.best.status ?? "none";
  return {
    key: `${w.market}:${w.symbol}`,
    symbol: stock.symbol,
    name: stock.name,
    kind: "Stock",
    market: w.market,
    href: `/stock/${w.market}/${encodeURIComponent(stock.symbol)}`,
    price: q ? money(q.price, w.market) : "—",
    changePct: q?.changePct ?? null,
    spark: [...live.candles.slice(-60).map((c) => c.c), ...(q ? [q.price] : [])],
    status: a ? `${tradeable(st) ? "⚡ " : ""}${STATUS_LABEL[st]} · ${a.best.side}` : "No data",
    statusCls: st,
    hint: a ? `${scoreRules(a.best.rules)}/100 of your swing rules · RSI ${a.rsi.toFixed(0)}` : "",
    hot: tradeable(st),
    logo: <Logo symbol={stock.symbol} market={w.market} size={36} />,
    starred,
  };
}

async function deskTile(w: Watch, starred: boolean): Promise<Tile | null> {
  const kind = w.market === "FX" ? "fx" : w.market === "CRYPTO" ? "crypto" : null;
  if (!kind) return null;
  const inst = deskInstruments(kind).find((i) => i.id === w.symbol);
  if (!inst) return null;
  const feed = await candles(inst, "5m");
  const now = Math.floor(Date.now() / 1000);
  const cs = feed?.candles ?? [];
  const r = cs.length ? analyseLiquidity(cs, { now, precision: inst.precision }) : null;
  const d = cs.length ? nyDesk(cs, { now, precision: inst.precision }) : null;
  const ny = d && (d.phase === "live" || (d.phase === "after" && d.events.length)) ? d : null;
  const stage = ny?.primary?.status ?? r?.stage ?? "no-data";
  const [label, cls] = STAGE_TEXT[stage] ?? ["—", "none"];
  const pc = cs.length ? prevDayClose(cs) : null;
  return {
    key: `${w.market}:${w.symbol}`,
    symbol: inst.short,
    name: inst.name,
    kind: kind === "fx" ? "Forex & commodities" : "Crypto",
    market: w.market,
    href: `${DESKS[kind].path}?s=${inst.id}`,
    price: feed ? fmtPrice(inst, feed.price) : "—",
    changePct: feed && pc ? ((feed.price - pc) / pc) * 100 : null,
    spark: cs.slice(-144).map((c) => c.c),
    status: ny?.primary ? `${label} · grade ${ny.primary.grade}` : label,
    statusCls: cls,
    hint: ny ? ny.headline : r?.headline ?? "",
    hot: stage === "ready" || stage === "triggered",
    logo: <Badge inst={inst} />,
    starred,
  };
}

/** Everything you follow, on one screen: stocks, XAU / forex, crypto — each read against your own strategy. */
export default async function Favourites({ list, suggested }: { list: Watch[]; suggested: boolean }) {
  const tiles = (await Promise.all(list.map((w) => (w.market === "FX" || w.market === "CRYPTO" ? deskTile(w, !suggested) : stockTile(w, !suggested))))).filter((t): t is Tile => !!t);
  const hot = tiles.filter((t) => t.hot).length;
  const order: Tile["kind"][] = ["Forex & commodities", "Crypto", "Stock"];
  return (
    <section className="favs">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>⭐ My favourites</h2>
        <span className="small muted">
          {hot ? <b className="up">{hot} setup{hot > 1 ? "s" : ""} ready</b> : "No setup ready right now"}
          {suggested ? " · starter list — tap ☆ on any stock, XAU/forex or crypto to build yours" : " · tap ★ to remove"}
        </span>
      </div>
      <div className="fav-grid">
        {tiles
          .sort((a, b) => Number(b.hot) - Number(a.hot) || order.indexOf(a.kind) - order.indexOf(b.kind))
          .map((t) => (
            <Link key={t.key} href={t.href} className={`fav ${t.hot ? "hot" : ""}`}>
              <div className="fav-head">
                {t.logo}
                <div className="fav-who">
                  <b>{t.symbol}</b>
                  <span className="small muted">{t.name}</span>
                </div>
                <StarButton symbol={t.key.split(":")[1]} market={t.market} starred={t.starred} />
              </div>
              <div className="fav-px">
                <b>{t.price}</b>
                <span className={tone(t.changePct)}>{pct(t.changePct)}</span>
              </div>
              <Sparkline values={t.spark} width={260} height={46} strokeWidth={1.6} />
              <div className="fav-foot">
                <span className={`pill ${t.statusCls}`}>{t.status}</span>
                <span className="small muted fav-kind">{t.kind}</span>
              </div>
              {t.hint && <div className="small muted fav-hint">{t.hint}</div>}
            </Link>
          ))}
      </div>
    </section>
  );
}
