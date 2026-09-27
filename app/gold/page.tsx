import { goldCandles, goldNews, usdEvents } from "@/lib/gold";
import { analyseLiquidity, headlineLean, prevDayClose, SESSIONS, sessionAt, tzOffset, type Stage } from "@/lib/liquidity";
import { getSettings } from "@/lib/data";
import { ago, pct, tone } from "@/lib/format";
import IntradayChart, { type Line, type Mark } from "@/components/IntradayChart";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const STAGE: Record<Stage, { label: string; cls: string }> = {
  waiting: { label: "Waiting for a sweep", cls: "none" },
  swept: { label: "Swept · not reclaimed", cls: "watch" },
  reclaimed: { label: "Reclaimed · wait for shift", cls: "watch" },
  ready: { label: "Setup ready", cls: "confirmed" },
  triggered: { label: "In the trade", cls: "confirmed" },
  invalidated: { label: "Invalidated", cls: "bad" },
  done: { label: "Played out", cls: "none" },
  both: { label: "Both sides taken · stand aside", cls: "bad" },
  "no-data": { label: "No data", cls: "none" },
};

const f2 = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const nyTime = (t: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000));

export default async function GoldPage() {
  const [data, news, events, settings] = await Promise.all([goldCandles(), goldNews(), usdEvents(), getSettings()]);
  if (!data) {
    return (
      <>
        <h1>Gold · XAU/USD</h1>
        <div className="note warn">Gold prices are unavailable from the data source right now. Nothing is shown rather than stale or made-up levels — try again in a minute.</div>
      </>
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const cs = data.candles;
  const r = analyseLiquidity(cs, { now });
  const pc = prevDayClose(cs);
  const dayPct = pc ? ((data.price - pc) / pc) * 100 : null;

  // Event risk: no new entries 30 min before to 15 min after a high-impact USD release.
  const high = events.filter((e) => e.impact === "High");
  const blackout = high.find((e) => now >= e.time - 1800 && now <= e.time + 900);
  const nextHigh = high.find((e) => e.time > now);
  const upcoming = events.filter((e) => e.time > now - 3600).slice(0, 8);

  const bars = cs.map(({ t, o, h, l, c }) => ({ t, o, h, l, c }));
  const colour = Object.fromEntries(SESSIONS.map((s) => [s.name, s.color])) as Record<string, string>;
  const bands = cs.map((c) => {
    const s = sessionAt(c.t);
    return s ? colour[s] : null;
  });
  const offsets = cs.map((c) => tzOffset(c.t));
  const lines: Line[] = [];
  const marks: Mark[] = [];
  const active = r?.plan && (r.stage === "ready" || r.stage === "triggered") ? r.plan : null;
  if (r?.prev) {
    lines.push({ price: r.prev.high, color: "#e2e2ee", title: `${r.prev.name} H`, style: 1 });
    lines.push({ price: r.prev.low, color: "#e2e2ee", title: `${r.prev.name} L`, style: 1 });
  }
  if (r?.pdh) lines.push({ price: r.pdh, color: "#fbbf24", title: "PDH", style: 2 });
  if (r?.pdl) lines.push({ price: r.pdl, color: "#fbbf24", title: "PDL", style: 2 });
  if (active) {
    lines.push({ price: active.entry, color: "#b39dfb", title: "Entry", style: 0 });
    lines.push({ price: active.stop, color: "#f43f5e", title: "Stop", style: 0 });
    lines.push({ price: active.tp1, color: "#22c55e", title: "TP1", style: 0 });
    lines.push({ price: active.tp2, color: "#22c55e", title: "TP2", style: 2 });
  }
  if (r?.sweep) marks.push({ t: cs[r.sweep.extremeI].t, above: r.sweep.side === "high", color: "#fbbf24", text: "Sweep" });
  if (r?.mss?.i != null) marks.push({ t: cs[r.mss.i].t, above: r.sweep?.side === "high", color: "#b39dfb", text: "MSS" });

  const st = r ? STAGE[r.stage] : STAGE["no-data"];
  // Size: risk % of the USD capital, 100 oz per standard lot.
  const riskUsd = (settings.capitalUsd * settings.riskPct) / 100;
  const lots = active ? riskUsd / (active.risk * 100) : null;
  const recent = r ? r.sessions.slice(-6).reverse() : [];

  return (
    <>
      <section className="hero-today gold">
        <div className="row between">
          <div>
            <div className="small muted">XAU/USD · {data.source} · updated {ago(data.time)}</div>
            <div className="row" style={{ gap: 12, alignItems: "baseline" }}>
              <div className="big-num">{f2(data.price)}</div>
              <b className={tone(dayPct)}>{pct(dayPct)}</b>
            </div>
            <div className="row chips">
              <span className={`pill ${st.cls}`}>{st.label}</span>
              <span className="pill">{r?.current ? `${r.current} session` : "Between sessions"}</span>
              {r?.prev && <span className="pill">Prev {r.prev.name}: {f2(r.prev.low)}–{f2(r.prev.high)}</span>}
              {blackout ? (
                <span className="pill bad">News blackout: {blackout.title}</span>
              ) : nextHigh ? (
                <span className="pill watch">Next red USD: {nextHigh.title} · {nyTime(nextHigh.time)} NY</span>
              ) : null}
            </div>
          </div>
          <AutoRefresh seconds={60} />
        </div>
      </section>

      <div className={`card decide ${st.cls}`}>
        <div className="small muted">What to do now · previous-session liquidity sweep</div>
        <h2 style={{ margin: "4px 0 6px" }}>{r?.headline ?? "No analysis"}</h2>
        <p style={{ margin: 0 }}>
          {blackout ? `High-impact USD news (${blackout.title}) is inside the blackout window — no new entries until 15 minutes after the release. ` : ""}
          {r?.action}
        </p>
        {active && (
          <div className="plan-grid">
            <div><div className="label">{active.side === "short" ? "Sell limit" : "Buy limit"}</div><b>{f2(active.entry)}</b></div>
            <div><div className="label">Stop</div><b className="down">{f2(active.stop)}</b><div className="small muted">{f2(active.risk)} risk</div></div>
            <div><div className="label">TP1 · 1:2</div><b className="up">{f2(active.tp1)}</b></div>
            <div><div className="label">TP2 · {active.rrTp2}R</div><b className="up">{f2(active.tp2)}</b></div>
            <div><div className="label">Size at {settings.riskPct}%</div><b>{lots === null ? "—" : `${lots.toFixed(2)} lots`}</b><div className="small muted">${riskUsd.toFixed(0)} risk · 100 oz/lot</div></div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <IntradayChart bars={bars} bands={bands} lines={lines} marks={marks} offsets={offsets} />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="card-title">Checklist</h3>
          {r?.steps.length ? (
            <ul className="rules">
              {r.steps.map((s) => (
                <li key={s.label}>
                  <span className={`mark ${s.done ? "ok" : "no"}`}>{s.done ? "✓" : "·"}</span>
                  <div><b>{s.label}</b><span>{s.detail}</span></div>
                </li>
              ))}
              <li>
                <span className={`mark ${blackout ? "no" : "ok"}`}>{blackout ? "✕" : "✓"}</span>
                <div><b>No red USD news in the window</b><span>{blackout ? blackout.title : nextHigh ? `next: ${nextHigh.title}, ${nyTime(nextHigh.time)} NY` : "none left this week"}</span></div>
              </li>
            </ul>
          ) : (
            <p className="small muted">No active sweep to track.</p>
          )}
          <div className="small muted" style={{ marginTop: 10 }}>PDH {f2(r?.pdh)} · PDL {f2(r?.pdl)} · 5m ATR {f2(r?.atr)}</div>
        </div>
        <div className="card">
          <h3 className="card-title">Recent sessions</h3>
          <table className="tbl">
            <thead><tr><th>Session</th><th className="num">High</th><th className="num">Low</th><th className="num">Range</th></tr></thead>
            <tbody>
              {recent.map((s) => (
                <tr key={`${s.name}${s.firstI}`}>
                  <td>
                    <b>{s.name}</b>
                    {!s.complete && <span className="pill watch" style={{ marginLeft: 6 }}>live</span>}
                    {r?.prev?.firstI === s.firstI && <span className="pill" style={{ marginLeft: 6 }}>prev</span>}
                    <div className="small muted">{nyTime(cs[s.firstI].t)}</div>
                  </td>
                  <td className="num">{f2(s.high)}</td>
                  <td className="num">{f2(s.low)}</td>
                  <td className="num">{f2(s.high - s.low)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="card-title">Gold news</h3>
          {!news.length && <p className="small muted">Headlines unavailable right now.</p>}
          <ul className="news">
            {news.map((n) => {
              const lean = headlineLean(n.title);
              return (
                <li key={n.link}>
                  <a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
                  <div className="small muted">
                    {n.source} · {ago(n.time)}
                    {lean && <span className={`pill ${lean === "bullish" ? "good" : "bad"}`} style={{ marginLeft: 6 }}>{lean}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="small muted">Bullish/bearish tags are keyword matches, not analysis. Headlines never override the chart setup.</p>
        </div>
        <div className="card">
          <h3 className="card-title">USD calendar</h3>
          {!upcoming.length && <p className="small muted">Calendar unavailable, or nothing left this week.</p>}
          <ul className="news">
            {upcoming.map((e) => (
              <li key={`${e.title}${e.time}`} className={e.time < now ? "muted" : ""}>
                <div className="row between">
                  <b>{e.title}</b>
                  <span className={`pill ${e.impact === "High" ? "bad" : "watch"}`}>{e.impact}</span>
                </div>
                <div className="small muted">{nyTime(e.time)} NY{e.forecast ? ` · forecast ${e.forecast}` : ""}{e.previous ? ` · prev ${e.previous}` : ""}</div>
              </li>
            ))}
          </ul>
          <p className="small muted">Rule: no new entries from 30 min before to 15 min after a red (high-impact) USD release.</p>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        A rules-based read of your strategy on closed 5-minute candles. It is not investment advice and not a prediction. Sessions are in New York time: Asia 20:00–03:00, London 03:00–07:00, New York 08:00–12:00.
      </p>
    </>
  );
}
