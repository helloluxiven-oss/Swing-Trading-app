import Link from "next/link";
import type { Decision } from "@/lib/decision";

const CLS: Record<Decision["action"], string> = { "BUY CALL": "good", "BUY PUT": "bad", "SELL PREMIUM": "watch", "NO TRADE": "none" };

/** The decision card: action, levels, and every factor that produced it. */
export default function TodayCall({ d, cur, name, expiryLabel, compact = false, href }: { d: Decision; cur: string; name: string; expiryLabel?: string; compact?: boolean; href?: string }) {
  const p = (x: number, dp = 2) => `${cur}${x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  const u = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const body = (
    <>
      <div className="row between">
        <div>
          <div className="small muted">{name}{expiryLabel ? ` · expiry ${expiryLabel}` : ""} · today&apos;s call</div>
          <div className={`call-action ${CLS[d.action]}`}>{d.action}</div>
          <div className="small">{d.headline}</div>
        </div>
        <div className="call-conf" title="Confidence: strength and agreement of the signals">
          <b>{d.confidence}</b><span className="small muted">/100</span>
        </div>
      </div>
      {d.trade && (
        <div className="call-levels">
          <div><span className="label">Trade</span><b>{d.trade.leg}</b><span className="small muted">Δ {d.trade.delta.toFixed(2)}</span></div>
          <div><span className="label">Entry</span><b>{p(d.trade.entry)}</b><span className="small muted">max {p(d.trade.entryMax)}</span></div>
          <div><span className="label">Stop</span><b className="down">{p(d.trade.stop)}</b><span className="small muted">or {u(d.trade.invalidation)} breaks</span></div>
          <div><span className="label">Target 1</span><b className="up">{p(d.trade.target1)}</b><span className="small muted">at {u(d.trade.under1)}</span></div>
          <div><span className="label">Target 2</span><b className="up">{p(d.trade.target2)}</b><span className="small muted">at {u(d.trade.under2)}</span></div>
        </div>
      )}
      {!compact && (
        <>
          {d.trade?.spread && <p className="small" style={{ margin: 0 }}>{d.trade.spread}</p>}
          <div className="factor-grid">
            {d.factors.map((f) => (
              <div key={f.name} className="factor">
                <div className="row between"><b>{f.name}</b><span className={f.score > 0.2 ? "up" : f.score < -0.2 ? "down" : "muted"}>{f.score > 0 ? "+" : ""}{f.score.toFixed(1)}</span></div>
                <span className="fbar"><i className={f.score >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(f.score) / 2) * 50}%` }} /></span>
                <span className="small muted">{f.note}</span>
              </div>
            ))}
          </div>
          {!!d.cautions.length && <ul className="why">{d.cautions.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p className="small muted" style={{ margin: 0 }}>Score {d.score > 0 ? "+" : ""}{d.score} (calls ≥ +2, puts ≤ −2, only when the inputs agree). Premium levels are model estimates for tomorrow; confirm the live bid/ask before entering. Not investment advice.</p>
        </>
      )}
    </>
  );
  return href ? <Link href={href} className={`card call-card ${CLS[d.action]}`}>{body}</Link> : <div className={`card call-card ${CLS[d.action]}`}>{body}</div>;
}
