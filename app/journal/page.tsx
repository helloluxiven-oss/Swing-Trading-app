import Link from "next/link";
import { getTrades } from "@/lib/data";
import { getSeries, mapLimit } from "@/lib/market";
import { resultR } from "@/lib/plan";
import { money, qtyFmt, tone } from "@/lib/format";
import { cancelTrade } from "../actions";
import CloseTrade from "@/components/CloseTrade";

import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function stats(rs: number[]) {
  if (!rs.length) return null;
  const wins = rs.filter((r) => r > 0).length;
  const sum = rs.reduce((a, b) => a + b, 0);
  return { n: rs.length, winRate: (wins / rs.length) * 100, avgR: sum / rs.length, totalR: sum };
}

export default async function JournalPage() {
  const trades = await getTrades();
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");
  const prices = await mapLimit(open, 6, (t) => getSeries(t.symbol, t.market, 30).then((s) => s?.quote.price ?? null));

  const all = stats(closed.map((t) => t.result_r ?? 0));
  const followed = stats(closed.filter((t) => t.followed_plan).map((t) => t.result_r ?? 0));
  const broken = stats(closed.filter((t) => t.followed_plan === false).map((t) => t.result_r ?? 0));

  const S = ({ title, s, hint }: { title: string; s: ReturnType<typeof stats>; hint: string }) => (
    <div className="card tight kpi">
      <div className="label">{title}</div>
      <div className="val">{s ? `${s.winRate.toFixed(0)}% · ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R` : "—"}</div>
      <div className="small muted">{s ? `${s.n} trades, total ${s.totalR >= 0 ? "+" : ""}${s.totalR.toFixed(1)}R` : hint}</div>
    </div>
  );

  return (
    <>
      <div className="row between"><h1>Journal</h1><AutoRefresh seconds={30} /></div>
      <p className="sub">Every plan you logged, with its stop-loss and target locked. R = result divided by what you risked.</p>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <S title="All closed trades" s={all} hint="No closed trades yet" />
        <S title="Followed the plan" s={followed} hint="Closed at your stop or target" />
        <S title="Broke the plan" s={broken} hint="Exited early or held on" />
      </div>

      <h2>Open ({open.length})</h2>
      {!open.length && <p className="note">No open trades. Find a setup on the <Link href="/scan" className="up">scanner</Link>.</p>}
      <div className="stack">
        {open.map((t, i) => {
          const px = prices[i];
          const r = px === null ? null : resultR(t.side, t.entry, t.stop, px);
          return (
            <div key={t.id} className="card">
              <div className="row between">
                <div className="row">
                  <Link href={`/stock/${t.market}/${encodeURIComponent(t.symbol)}`}><b>{t.symbol}</b></Link>
                  <span className={`pill ${t.side}`}>{t.side}</span>
                  <span className="small muted">logged {new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                <div className={`row ${tone(r)}`}>
                  <b>{px === null ? "—" : money(px, t.market)}</b>
                  <span>{r === null ? "" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`}</span>
                </div>
              </div>
              <div className="grid g4 small" style={{ marginTop: 8 }}>
                <div><span className="muted">Entry</span> {money(t.entry, t.market)}</div>
                <div><span className="muted">Stop</span> <span className="down">{money(t.stop, t.market)}</span> 🔒</div>
                <div><span className="muted">Target</span> <span className="up">{money(t.target, t.market)}</span> 🔒</div>
                <div><span className="muted">Qty</span> {qtyFmt(t.qty)}</div>
              </div>
              {t.plan_note && <p className="small muted" style={{ marginTop: 6 }}>“{t.plan_note}”</p>}
              <CloseTrade id={t.id} suggested={px} />
              <form action={cancelTrade} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <button className="btn small danger">Never entered — cancel the plan</button>
              </form>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>Closed</h2>
      <div className="card scroll" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr><th>Date</th><th>Stock</th><th>Side</th><th className="num">Entry</th><th className="num">Exit</th><th className="num">Result</th><th>Plan</th><th>Lesson</th></tr>
          </thead>
          <tbody>
            {closed.map((t) => (
              <tr key={t.id}>
                <td className="small">{t.closed_at?.slice(0, 10)}</td>
                <td><b>{t.symbol}</b></td>
                <td><span className={`pill ${t.side}`}>{t.side}</span></td>
                <td className="num">{money(t.entry, t.market)}</td>
                <td className="num">{money(t.exit_price, t.market)}</td>
                <td className={`num ${tone(t.result_r)}`}>{t.result_r === null ? "—" : `${t.result_r >= 0 ? "+" : ""}${t.result_r.toFixed(2)}R`}</td>
                <td>{t.followed_plan ? <span className="pill good">followed</span> : <span className="pill bad">broken</span>}</td>
                <td className="small muted">{t.lesson}</td>
              </tr>
            ))}
            {!closed.length && <tr><td colSpan={8} className="muted" style={{ padding: 20, textAlign: "center" }}>Nothing closed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
