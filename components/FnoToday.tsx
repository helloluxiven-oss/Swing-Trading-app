import { todayCall } from "@/lib/fnocall";
import TodayCall from "./TodayCall";

/** Dashboard: today's options call for NIFTY, BTC and ETH. */
export default async function FnoToday() {
  const all = await Promise.all((["NIFTY", "BTC", "ETH"] as const).map((u) => todayCall(u)));
  return (
    <section style={{ marginTop: 18 }}>
      <div className="row between"><h2 className="section-title" style={{ margin: 0 }}>📊 Options today</h2><a href="/fno" className="small">Full F&amp;O analysis →</a></div>
      <div className="grid g3" style={{ marginTop: 10 }}>
        {all.map((r) =>
          r.decision && r.chain ? (
            <TodayCall key={r.meta.id} d={r.decision} cur={r.meta.currency} name={r.meta.name} expiryLabel={r.chain.expiries.find((e) => e.ts === r.chain!.expiry)?.label} compact href={`/fno?u=${r.meta.id}`} />
          ) : (
            <div key={r.meta.id} className="card"><b>{r.meta.name}</b><p className="small muted">Option data unavailable right now.</p></div>
          ),
        )}
      </div>
    </section>
  );
}
