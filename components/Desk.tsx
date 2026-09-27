import { calendar, candles, headlines, quotes, TFS, type Tf } from "@/lib/feeds";
import { DESKS, deskInstruments, findInstrument, fmtPrice, hasStrategy, sizeFor, type DeskKind } from "@/lib/instruments";
import { analyseLiquidity, dayLevels, nyDesk, type SweepEvent, headlineLean, prevDayClose, tzOffset, type Stage } from "@/lib/liquidity";
import { getSettings } from "@/lib/data";
import { ago, pct, tone } from "@/lib/format";
import IntradayChart, { type Mark } from "@/components/IntradayChart";
import type { Drawings } from "@/components/chart/annotations";
import AutoRefresh from "@/components/AutoRefresh";
import SweepAlert from "@/components/SweepAlert";
import InstrumentStrip from "@/components/InstrumentStrip";
import StarButton from "@/components/StarButton";
import { getWatchlist } from "@/lib/data";

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

const nyTime = (t: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000));

/** Today's 08:00–12:00 New York window in the viewer's timezone (handles daylight saving on both sides). */
function nyWindowLocal(tz: string) {
  const now = Math.floor(Date.now() / 1000);
  const ny = new Date((now + tzOffset(now)) * 1000);
  const at = (h: number) => {
    const guess = Date.UTC(ny.getUTCFullYear(), ny.getUTCMonth(), ny.getUTCDate(), h) / 1000;
    return guess - tzOffset(guess);
  };
  const f = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t * 1000));
  return `${f(at(8))}–${f(at(12))}`;
}

const EV_STATUS: Record<SweepEvent["status"], { label: string; cls: string }> = {
  testing: { label: "Testing beyond", cls: "watch" },
  breakout: { label: "Breakout (accepted)", cls: "bad" },
  reclaimed: { label: "Reclaimed · wait for shift", cls: "watch" },
  ready: { label: "Setup ready", cls: "confirmed" },
  triggered: { label: "In the trade", cls: "confirmed" },
  invalidated: { label: "Failed", cls: "bad" },
  done: { label: "Played out", cls: "none" },
};

/**
 * One intraday desk (Forex & Commodities or Crypto) running the
 * previous-session liquidity-sweep strategy on the selected instrument.
 */
export default async function Desk({ kind, searchParams }: { kind: DeskKind; searchParams: Promise<{ tf?: string; s?: string }> }) {
  const sp = await searchParams;
  const tf: Tf = (TFS as string[]).includes(sp.tf ?? "") ? (sp.tf as Tf) : "5m";
  const inst = findInstrument(kind, sp.s);
  const list = deskInstruments(kind);
  const fp = (x: number | null | undefined) => fmtPrice(inst, x);
  const [data, news, events, settings, chartData, qs] = await Promise.all([
    candles(inst, "5m"),
    headlines(inst.query),
    calendar(inst.news),
    getSettings(),
    tf === "5m" ? Promise.resolve(null) : candles(inst, tf),
    quotes(list),
  ]);
  const fav = (await getWatchlist()).some((w) => w.symbol === inst.id && w.market === (kind === "fx" ? "FX" : "CRYPTO"));
  const star = <StarButton symbol={inst.id} market={kind === "fx" ? "FX" : "CRYPTO"} starred={fav} />;
  const strip = <InstrumentStrip kind={kind} list={list} quotes={qs} active={inst.id} tf={tf} />;
  if (!data) {
    return (
      <>
        {strip}
        <h1>{inst.name}</h1>
        <div className="note warn">{inst.name} prices are unavailable from the data source right now. Nothing is shown rather than stale or made-up levels — try again in a minute.</div>
      </>
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const cs = data.candles;
  const r = analyseLiquidity(cs, { now, precision: inst.precision });
  const pc = prevDayClose(cs);
  const dayPct = pc ? ((data.price - pc) / pc) * 100 : null;

  // Event risk: no new entries 30 min before to 15 min after a high-impact USD release.
  const high = events.filter((e) => e.impact === "High");
  const blackout = high.find((e) => now >= e.time - 1800 && now <= e.time + 900);
  const nextHigh = high.find((e) => e.time > now);
  const upcoming = events.filter((e) => e.time > now - 3600).slice(0, 8);

  if (!hasStrategy(inst)) {
    // Market view only: the liquidity-sweep strategy runs on XAU and the forex pairs.
    const ccs0 = chartData?.candles ?? cs;
    const pd = analyseLiquidity(cs, { now, precision: inst.precision });
    const dayKey = (t: number) => new Date((t + tzOffset(t) + 7 * 3600) * 1000).toISOString().slice(0, 10);
    const today = cs.filter((c) => dayKey(c.t) === dayKey(cs[cs.length - 1].t));
    const dayHi = today.length ? Math.max(...today.map((c) => c.h)) : null;
    const dayLo = today.length ? Math.min(...today.map((c) => c.l)) : null;
    const view: Drawings = {
      boxes: [],
      rays: [
        ...(pd?.pdh ? [{ from: cs[0].t, to: null, price: pd.pdh, color: "#fbbf24", label: "PDH" }] : []),
        ...(pd?.pdl ? [{ from: cs[0].t, to: null, price: pd.pdl, color: "#fbbf24", label: "PDL" }] : []),
      ],
      zones: [],
      precision: inst.precision,
    };
    return (
      <>
        {strip}
        <section className={`hero-today ${kind === "crypto" ? "crypto" : "gold"}`}>
          <div className="row between">
            <div>
              <div className="small muted">{DESKS[kind].title} · <b style={{ color: "var(--ink)" }}>{inst.name}</b> · {data.source} · updated {ago(data.time)}</div>
              <div className="row" style={{ gap: 12, alignItems: "baseline" }}>
                <div className="big-num">{fp(data.price)}</div>
                <b className={tone(dayPct)}>{pct(dayPct)}</b>
              </div>
              <div className="row chips">
                <span className="pill none">Market view · no strategy</span>
                <span className="pill">Day {fp(dayLo)} – {fp(dayHi)}</span>
                <span className="pill">PDH {fp(pd?.pdh)} · PDL {fp(pd?.pdl)}</span>
                {nextHigh ? <span className="pill watch">Next red {nextHigh.country}: {nextHigh.title} · {nyTime(nextHigh.time)} NY</span> : null}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>{star}<AutoRefresh seconds={data.live ? 15 : 60} /></div>
          </div>
        </section>
        <p className="note small" style={{ marginTop: 12 }}>
          The liquidity-sweep strategy runs on <b>XAU and the forex pairs</b> only. {inst.name} is shown as a live market view — chart, previous-day levels and news — with no sweep signals or trade plans.
        </p>
        <div className="card chart-card" style={{ marginTop: 12 }}>
          <IntradayChart bars={ccs0.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }))} drawings={view} marks={[]} offsets={ccs0.map((c) => tzOffset(c.t))} tf={tf} symbol={inst.id} precision={inst.precision} hrefBase={`${DESKS[kind].path}?s=${inst.id}&tf=`} sessions={false} />
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <div className="card">
            <h3 className="card-title">{inst.name} news</h3>
            {!news.length && <p className="small muted">Headlines unavailable right now.</p>}
            <ul className="news">
              {news.map((n) => (
                <li key={n.link}>
                  <a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
                  <div className="small muted">{n.source} · {ago(n.time)}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="card-title">{inst.news.join(" · ")} calendar</h3>
            {!upcoming.length && <p className="small muted">Calendar unavailable, or nothing left this week.</p>}
            <ul className="news">
              {upcoming.map((e) => (
                <li key={`${e.title}${e.time}`} className={e.time < now ? "muted" : ""}>
                  <div className="row between">
                    <b><span className="muted small">{e.country}</span> {e.title}</b>
                    <span className={`pill ${e.impact === "High" ? "bad" : "watch"}`}>{e.impact}</span>
                  </div>
                  <div className="small muted">{nyTime(e.time)} NY{e.forecast ? ` · forecast ${e.forecast}` : ""}{e.previous ? ` · prev ${e.previous}` : ""}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </>
    );
  }

  // NY sweep monitor: every resting pool of the day, graded sweeps during New York.
  const desk = nyDesk(cs, { now, redNews: high.map((e) => e.time), precision: inst.precision });
  const nyMode = !!desk && (desk.phase === "live" || (desk.phase === "after" && desk.events.length > 0));
  const nyPlan = desk?.primary?.plan && (desk.primary.status === "ready" || desk.primary.status === "triggered") ? desk.primary.plan : null;

  // The chart can be any timeframe; the strategy always reads 5-minute candles.
  const ccs = chartData?.candles ?? cs;
  const bars = ccs.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
  const offsets = ccs.map((c) => tzOffset(c.t));
  const marks: Mark[] = [];
  const active = nyMode ? nyPlan : r?.plan && (r.stage === "ready" || r.stage === "triggered") ? r.plan : null;
  const SESSION_COLOUR: Record<string, string> = { Asia: "#60a5fa", London: "#22c55e", "New York": "#f472b6" };
  const lvls = dayLevels(cs);
  const lastI = cs.length - 1;

  // Session boxes (high → low), today's session highs/lows as rays, PDH/PDL, and the live plan as a zone.
  // Clean chart: session boxes (label says which side NY/later sessions swept), PDH/PDL lines, the live plan zone.
  const sweptOf = (firstI: number, kind: "high" | "low") => lvls.find((l) => l.kind === kind && cs[l.fromI].t >= cs[firstI].t && l.sweptI !== null && r?.sessions.some((b) => b.firstI === firstI && l.fromI >= b.firstI && l.fromI <= b.lastI));
  const drawings: Drawings = {
    boxes: (r?.sessions ?? []).map((b) => {
      const tags = [sweptOf(b.firstI, "high") ? "H✕" : "", sweptOf(b.firstI, "low") ? "L✕" : ""].filter(Boolean).join(" ");
      return {
        from: cs[b.firstI].t,
        to: cs[b.lastI].t,
        top: b.high,
        bottom: b.low,
        color: SESSION_COLOUR[b.name],
        label: `${b.name}${tags ? ` · ${tags}` : ""} · ${fp(b.high - b.low)}`,
        live: !b.complete,
      };
    }),
    rays: [
      ...(r?.pdh ? [{ from: cs[0].t, to: null, price: r.pdh, color: "#fbbf24", label: "PDH" }] : []),
      ...(r?.pdl ? [{ from: cs[0].t, to: null, price: r.pdl, color: "#fbbf24", label: "PDL" }] : []),
    ],
    zones: active
      ? [{ from: cs[(nyMode ? desk?.primary?.mssI : r?.mss?.i) ?? lastI].t, entry: active.entry, stop: active.stop, target: active.tp1, side: active.side }]
      : [],
  };
  if (desk?.events.length) {
    for (const e of desk.events) {
      const gradeCol = e.grade === "A" ? "#22c55e" : e.grade === "B" ? "#fbbf24" : "#8a8aa6";
      marks.push({ t: cs[e.extremeI].t, above: e.kind === "high", color: gradeCol, text: `⚡ ${e.pools.map((n) => n.replace(" high", " H").replace(" low", " L").replace("London", "LO").replace("Asia", "AS").replace("Prev day", "PD")).join("+")} · ${e.grade}` });
      if (e.mssI !== null) marks.push({ t: cs[e.mssI].t, above: e.kind === "high", color: "#b39dfb", text: "MSS" });
    }
  } else {
    if (r?.sweep) marks.push({ t: cs[r.sweep.extremeI].t, above: r.sweep.side === "high", color: "#fbbf24", text: "Sweep" });
    if (r?.mss?.i != null) marks.push({ t: cs[r.mss.i].t, above: r.sweep?.side === "high", color: "#b39dfb", text: "MSS" });
  }

  const st = nyMode && desk?.primary ? EV_STATUS[desk.primary.status] : r ? STAGE[r.stage] : STAGE["no-data"];
  const headline = nyMode ? desk!.headline : desk?.phase === "pre" && r?.current !== "London" ? desk.headline : r?.headline ?? "No analysis";
  const action = nyMode ? desk!.action : desk?.phase === "pre" && r?.current !== "London" ? desk.action : r?.action;
  // Size: risk % of the USD capital, converted through the instrument's lot size.
  const riskUsd = (settings.capitalUsd * settings.riskPct) / 100;
  const size = active ? sizeFor(inst, riskUsd, active.risk, data.price) : null;

  return (
    <>
      {strip}
      <section className={`hero-today ${kind === "crypto" ? "crypto" : "gold"}`}>
        <div className="row between">
          <div>
            <div className="small muted">{DESKS[kind].title} · <b style={{ color: "var(--ink)" }}>{inst.name}</b> · {data.source} · updated {ago(data.time)}</div>
            <div className="row" style={{ gap: 12, alignItems: "baseline" }}>
              <div className="big-num">{fp(data.price)}</div>
              <b className={tone(dayPct)}>{pct(dayPct)}</b>
            </div>
            <div className="row chips">
              <span className={`pill ${st.cls}`}>{st.label}</span>
              <span className="pill">{r?.current ? `${r.current} session` : "Between sessions"}</span>
              <SweepAlert events={(desk?.events ?? []).map((e) => ({ id: e.id, text: e.text, grade: e.grade }))} />
              {r?.prev && <span className="pill">Prev {r.prev.name}: {fp(r.prev.low)}–{fp(r.prev.high)}</span>}
              {blackout ? (
                <span className="pill bad">News blackout: {blackout.title}</span>
              ) : nextHigh ? (
                <span className="pill watch">Next red {nextHigh.country}: {nextHigh.title} · {nyTime(nextHigh.time)} NY</span>
              ) : null}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>{star}<AutoRefresh seconds={data.live ? 15 : 60} /></div>
        </div>
      </section>

      {!data.live && (
        <div className="note warn" style={{ marginTop: 12 }}>
          Delayed feed: {data.source}. Levels may not match your broker&apos;s chart exactly — use the stages and R multiples, and read prices off your own chart.{kind === "fx" ? " Real-time OANDA prices switch on as soon as an OANDA token is added." : ""}
        </div>
      )}
      {r && r.current !== "New York" && (
        <div className="note" style={{ marginTop: 12 }}>
          <b>Your session is New York</b> — 08:00–12:00 New York = {nyWindowLocal(settings.timezone)} your time. {r.current === "London" ? "London is running now: its high and low are the liquidity your NY trade will sweep. Mark them, don't trade them." : "Outside NY hours: plan only, no entries."}
        </div>
      )}
      <div className={`card decide ${st.cls}`}>
        <div className="small muted">What to do now · {nyMode ? "NY sweep monitor" : "previous-session liquidity sweep"}</div>
        <h2 style={{ margin: "4px 0 6px" }}>{headline}</h2>
        <p style={{ margin: 0 }}>
          {blackout ? `High-impact ${blackout.country} news (${blackout.title}) is inside the blackout window — no new entries until 15 minutes after the release. ` : ""}
          {action}
        </p>
        {active && (
          <div className="plan-grid">
            <div><div className="label">{active.side === "short" ? "Sell limit" : "Buy limit"}</div><b>{fp(active.entry)}</b></div>
            <div><div className="label">Stop</div><b className="down">{fp(active.stop)}</b><div className="small muted">{fp(active.risk)} risk</div></div>
            <div><div className="label">TP1 · 1:2</div><b className="up">{fp(active.tp1)}</b></div>
            <div><div className="label">TP2 · {active.rrTp2}R</div><b className="up">{fp(active.tp2)}</b></div>
            <div><div className="label">Size at {settings.riskPct}%</div><b>{size?.label ?? "—"}</b><div className="small muted">${riskUsd.toFixed(0)} risk{kind === "fx" ? ` · ${inst.lot.toLocaleString()} ${inst.unit}/lot` : ""}</div></div>
          </div>
        )}
      </div>

      <div className="card chart-card" style={{ marginTop: 16 }}>
        <IntradayChart bars={bars} drawings={{ ...drawings, precision: inst.precision }} marks={marks} offsets={offsets} tf={tf} symbol={inst.id} precision={inst.precision} hrefBase={`${DESKS[kind].path}?s=${inst.id}&tf=`} />
        {tf !== "5m" && <div className="small muted" style={{ marginTop: 6 }}>Viewing {tf.toUpperCase()}. Sweeps, grades and the plan are always read from 5-minute candles.</div>}
      </div>

      {desk && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between">
            <h3 className="card-title" style={{ margin: 0 }}>NY sweep monitor</h3>
            <span className={`pill ${desk.phase === "live" ? "confirmed" : "none"}`}>{desk.phase === "live" ? "● NY live" : desk.phase === "pre" ? "Before NY" : "NY closed"}</span>
          </div>
          <div className="pools">
            {[...desk.pools].sort((a, b) => b.price - a.price).map((p) => {
              const ev = desk.events.find((e) => e.pools.includes(p.name));
              return (
                <div key={p.name} className={`pool ${p.takenBeforeNY ? "spent" : ev ? "hit" : "rest"}`}>
                  <b>{p.name}</b>
                  <span className="mono">{fp(p.price)}</span>
                  <span className="small">{p.takenBeforeNY ? "spent before NY" : ev ? `swept · ${ev.grade}` : `resting · ${fp(Math.abs(p.price - data.price))} away`}</span>
                </div>
              );
            })}
          </div>
          {desk.events.length ? (
            <ul className="events">
              {[...desk.events].reverse().map((e) => (
                <li key={e.id}>
                  <div className="row between">
                    <span><span className={`grade g${e.grade}`}>{e.grade}</span> <b>{e.text.split(" · ").slice(0, 2).join(" · ")}</b></span>
                    <span className={`pill ${EV_STATUS[e.status].cls}`}>{EV_STATUS[e.status].label}</span>
                  </div>
                  <div className="meter" style={{ margin: "8px 0" }}><span className="bar"><i style={{ width: `${e.score}%` }} /></span><span className="small">{e.score}/100</span></div>
                  <div className="factors">
                    {e.factors.map((f) => (
                      <span key={f.label} className={f.pass ? "ok" : "no"}>{f.pass ? "✓" : "✕"} {f.label}{f.pass && f.points > 0 ? ` +${f.points}` : f.points < 0 ? ` ${f.points}` : ""}</span>
                    ))}
                  </div>
                  {e.plan && <div className="small muted" style={{ marginTop: 6 }}>{e.plan.side === "short" ? "Sell" : "Buy"} {fp(e.plan.entry)} · stop {fp(e.plan.stop)} · TP1 {fp(e.plan.tp1)} · TP2 {fp(e.plan.tp2)} ({e.plan.rrTp2}R)</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ marginTop: 10 }}>{desk.phase === "pre" ? "No NY sweeps yet — the session hasn't started. Resting pools above are what NY will hunt." : "No resting pool swept in NY yet."}</p>
          )}
          <p className="small muted">Grade = level (London 25, PDH/PDL 20, Asia 15) + confluence 10 + fast rejection 20 + killzone 15 + clean wick 10 + volume 10 + structure shift 20 + no news 10, minus 20 if NY took both London sides. A ≥ 75 · B ≥ 55 · C below.</p>
        </div>
      )}

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
                <div><b>No red {inst.news.join("/")} news in the window</b><span>{blackout ? blackout.title : nextHigh ? `next: ${nextHigh.title}, ${nyTime(nextHigh.time)} NY` : "none left this week"}</span></div>
              </li>
            </ul>
          ) : (
            <p className="small muted">No active sweep to track.</p>
          )}
          <div className="small muted" style={{ marginTop: 10 }}>PDH {fp(r?.pdh)} · PDL {fp(r?.pdl)} · 5m ATR {fp(r?.atr)}</div>
        </div>
        <div className="card">
          <h3 className="card-title">Session highs &amp; lows today</h3>
          <table className="tbl">
            <thead><tr><th>Level</th><th className="num">Price</th><th className="num">From now</th><th>Liquidity</th></tr></thead>
            <tbody>
              {[...lvls].sort((x, y) => y.price - x.price).map((l) => {
                const isPrev = r?.prev && l.endI === r.prev.lastI;
                return (
                  <tr key={`${l.session}${l.kind}${l.fromI}`}>
                    <td>
                      <i className="dot" style={{ background: SESSION_COLOUR[l.session] }} />
                      <b>{l.session} {l.kind}</b>
                      {l.live && <span className="pill watch" style={{ marginLeft: 6 }}>forming</span>}
                      {isPrev && <span className="pill" style={{ marginLeft: 6 }}>prev session</span>}
                      <div className="small muted">{nyTime(cs[l.fromI].t)} NY</div>
                    </td>
                    <td className="num">{fp(l.price)}</td>
                    <td className={`num ${tone(l.price - data.price)}`}>{l.price - data.price >= 0 ? "+" : ""}{fp(l.price - data.price)}</td>
                    <td>{l.live ? <span className="pill none">still forming</span> : l.sweptI !== null ? <span className="pill bad">swept {nyTime(cs[l.sweptI].t).split(" ")[1]}</span> : <span className="pill good">resting</span>}</td>
                  </tr>
                );
              })}
              {r?.pdh != null && <tr><td><b>Prev day high</b></td><td className="num">{fp(r.pdh)}</td><td className={`num ${tone(r.pdh - data.price)}`}>{fp(r.pdh - data.price)}</td><td /></tr>}
              {r?.pdl != null && <tr><td><b>Prev day low</b></td><td className="num">{fp(r.pdl)}</td><td className={`num ${tone(r.pdl - data.price)}`}>{fp(r.pdl - data.price)}</td><td /></tr>}
            </tbody>
          </table>
          <p className="small muted">Resting = untouched liquidity (a target / sweep candidate). Swept = already taken.</p>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="card-title">{inst.name} news</h3>
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
          <h3 className="card-title">{inst.news.join(" · ")} calendar</h3>
          {!upcoming.length && <p className="small muted">Calendar unavailable, or nothing left this week.</p>}
          <ul className="news">
            {upcoming.map((e) => (
              <li key={`${e.title}${e.time}`} className={e.time < now ? "muted" : ""}>
                <div className="row between">
                  <b><span className="muted small">{e.country}</span> {e.title}</b>
                  <span className={`pill ${e.impact === "High" ? "bad" : "watch"}`}>{e.impact}</span>
                </div>
                <div className="small muted">{nyTime(e.time)} NY{e.forecast ? ` · forecast ${e.forecast}` : ""}{e.previous ? ` · prev ${e.previous}` : ""}</div>
              </li>
            ))}
          </ul>
          <p className="small muted">Rule: no new entries from 30 min before to 15 min after a red (high-impact) release.</p>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        A rules-based read of your strategy on closed 5-minute candles. It is not investment advice and not a prediction. Sessions are in New York time: Asia 20:00–03:00, London 03:00–07:00, New York 08:00–12:00; the day rolls at 17:00 New York.
        {kind === "crypto" ? " Crypto trades 24/7 — the sessions mark when each region's liquidity is active, and weekends are thin: treat weekend sweeps as grade C." : ""}
      </p>
    </>
  );
}
