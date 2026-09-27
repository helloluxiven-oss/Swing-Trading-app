import Link from "next/link";
import { scanMarket, type MarketScan } from "@/lib/scan";
import { getSettings, getTrades, recentClosed } from "@/lib/data";
import { inOfficeHours, lossStreak } from "@/lib/gate";
import { STATUS_LABEL } from "@/lib/setup";
import { money, pct, tone } from "@/lib/format";
import RuleDots from "@/components/RuleDots";

import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function Pulse({ s }: { s: MarketScan }) {
  const q = s.index.quote;
  const ctx = s.index.ctx;
  const setups = s.rows.filter((r) => r.analysis && (r.analysis.best.status === "ready" || r.analysis.best.status === "confirmed"));
  const watch = s.rows.filter((r) => r.analysis?.best.status === "watch").length;
  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <div className="small muted">{s.market === "IN" ? "India" : "United States"}</div>
          <h2 style={{ margin: 0 }}>{s.index.name}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <b style={{ fontSize: 18 }}>{q ? money(q.price, s.market) : "—"}</b>
          <div className={`small ${tone(q?.changePct)}`}>{q ? pct(q.changePct) : "unavailable"}</div>
        </div>
      </div>
      <div className="row">
        {ctx === null ? <span className="pill none">Market filter unknown</span> : ctx.above50 ? <span className="pill good">Above 50 EMA · longs only</span> : <span className="pill bad">Below 50 EMA · shorts only</span>}
        <span className="pill">{setups.length} setups</span>
        <span className="pill watch">{watch} on watch</span>
      </div>
      {setups.length ? (
        <table className="tbl">
          <tbody>
            {setups.slice(0, 6).map(({ stock, analysis: a, quote }) => (
              <tr key={stock.symbol}>
                <td><Link href={`/stock/${s.market}/${encodeURIComponent(stock.symbol)}`}><b>{stock.symbol}</b></Link></td>
                <td><span className={`pill ${a!.best.status}`}>{STATUS_LABEL[a!.best.status]}</span> <span className={`pill ${a!.best.side}`}>{a!.best.side}</span></td>
                <td><RuleDots rules={a!.best.rules} /></td>
                <td className={`num ${tone(quote?.changePct)}`}>{quote ? pct(quote.changePct) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="note small">No stock passes all five required rules today. No setup, no trade.</p>
      )}
      <Link href={`/scan?m=${s.market}`} className="small up">Full {s.market === "IN" ? "India" : "US"} scan →</Link>
    </div>
  );
}

export default async function Today() {
  const [inScan, usScan, settings, trades, recent] = await Promise.all([
    scanMarket("IN"),
    scanMarket("US"),
    getSettings(),
    getTrades(),
    recentClosed(),
  ]);
  const now = new Date();
  const office = inOfficeHours(now, settings);
  const { streak, lastLossToday } = lossStreak(recent, now, settings.timezone);
  const cooling = streak >= settings.maxConsecutiveLosses && lastLossToday;
  const open = trades.filter((t) => t.status === "open").length;

  return (
    <>
      <div className="row between"><h1>Today</h1><AutoRefresh seconds={60} /></div>
      <p className="sub">Your setups in both markets, and whether you are allowed to act on them right now.</p>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className={`note ${office ? "warn" : "good"}`}>
          <b>{office ? "Office hours — analysis only" : "Outside office hours"}</b>
          <div className="small">{office ? "New trades are blocked until " + settings.officeEnd + "." : "The gate is open if your setup and your head are right."}</div>
        </div>
        <div className={`note ${cooling ? "bad" : "good"}`}>
          <b>{cooling ? `Cool-down: ${streak} losses in a row` : streak ? `${streak} loss${streak > 1 ? "es" : ""} in a row` : "No losing streak"}</b>
          <div className="small">{cooling ? "“Take a break here.” Blocked until tomorrow." : `Blocks at ${settings.maxConsecutiveLosses} in a row on the same day.`}</div>
        </div>
        <div className="note">
          <b>{open} open trade{open === 1 ? "" : "s"}</b>
          <div className="small"><Link href="/journal" className="up">Journal →</Link></div>
        </div>
      </div>

      <div className="grid g2">
        <Pulse s={inScan} />
        <Pulse s={usScan} />
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Not investment advice. The app checks your own rules against live data; it does not predict prices or place orders.
      </p>
    </>
  );
}
