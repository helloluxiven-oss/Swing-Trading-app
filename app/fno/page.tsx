import Link from "next/link";
import { fiiDii, getChain, UNDERLYINGS, type Underlying } from "@/lib/derivs";
import { analyseChain, gex, greeks, yearsTo } from "@/lib/options";
import { buildStrategies, realisedVol } from "@/lib/strategies";
import { headlines } from "@/lib/feeds";
import { getIntraday } from "@/lib/market";
import { headlineLean } from "@/lib/liquidity";
import { ago, pct, tone } from "@/lib/format";
import AutoRefresh from "@/components/AutoRefresh";
import { GexChart, OIChart, Payoff, SmileChart } from "@/components/FnoCharts";
import TodayCall from "@/components/TodayCall";
import { decide, newsLean } from "@/lib/decision";

export const dynamic = "force-dynamic";

const SPOT_SYMBOL: Record<Underlying, string> = { NIFTY: "^NSEI", SENSEX: "^BSESN", BTC: "BTC-USD", ETH: "ETH-USD" };
const NEWS: Record<Underlying, string> = {
  NIFTY: "Nifty options OR Nifty 50 OR F&O expiry",
  SENSEX: "Sensex options OR Sensex expiry OR BSE Sensex",
  BTC: "bitcoin options OR bitcoin price OR BTC",
  ETH: "ethereum options OR ethereum price OR ETH",
};

export default async function FnoPage({ searchParams }: { searchParams: Promise<{ u?: string; e?: string }> }) {
  const sp = await searchParams;
  const meta = UNDERLYINGS.find((x) => x.id === sp.u?.toUpperCase()) ?? UNDERLYINGS[0];
  const u = meta.id;
  const india = meta.market === "india";
  const [chain, daily, news, flows] = await Promise.all([
    getChain(u, sp.e ? Number(sp.e) : undefined),
    getIntraday(SPOT_SYMBOL[u], "1d", "6mo", 900),
    headlines(NEWS[u], 10),
    india ? fiiDii() : Promise.resolve(null),
  ]);
  const cur = meta.currency;
  const f0 = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${cur}${x.toLocaleString(india ? "en-IN" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);

  const tabs = (
    <div className="fno-tabs" role="tablist">
      {UNDERLYINGS.map((x) => (
        <Link key={x.id} href={`/fno?u=${x.id}`} className={x.id === u ? "on" : ""} role="tab" aria-selected={x.id === u}>
          {x.market === "india" ? "🇮🇳" : "₿"} {x.id}
        </Link>
      ))}
    </div>
  );

  if (!chain || !chain.rows.length) {
    return (
      <>
        <section className="hero-today"><h1 style={{ margin: 0 }}>Options &amp; Futures</h1>{tabs}</section>
        <div className="note warn" style={{ marginTop: 12 }}>
          {india
            ? u === "SENSEX"
              ? "SENSEX options: BSE refuses requests from cloud servers (it answers “Access Denied”), so this app cannot read the BSE option chain directly. India VIX, FII/DII and news are below. Connect a broker API (Upstox or Dhan — free with an account) and the full SENSEX chain, greeks and strategies switch on here."
              : `${u} option chain is unavailable right now — NSE sometimes refuses cloud servers or returns empty data outside market hours. Try again shortly; a broker API (Upstox or Dhan) makes it dependable.`
            : "Deribit did not answer just now — try again in a moment."}
        </div>
        {flows && <FlowsCard flows={flows} />}
      </>
    );
  }

  const T = yearsTo(chain.expiry);
  const spot = chain.spot;
  const a = analyseChain(chain.rows, spot, T, (x) => f0(x));
  const rv = realisedVol((daily?.candles ?? []).map((c) => c.c), 30, india ? 252 : 365);
  const ivAtm = a.atmIV ?? 0;
  const step = chain.rows.length > 1 ? chain.rows[1].strike - chain.rows[0].strike : 1;
  const strategies = ivAtm ? buildStrategies(chain.rows, { spot, T, ivAtm, rv, a, step }) : [];
  // Focus the charts on the strikes that matter: about ±2.5 expected moves around spot.
  const band = (a.expectedMove ?? spot * 0.05) * 2.5;
  const near = chain.rows.filter((r) => Math.abs(r.strike - spot) <= band);
  const show = near.length >= 8 ? near : chain.rows.slice(Math.max(0, chain.rows.findIndex((r) => r.strike >= spot) - 10), chain.rows.findIndex((r) => r.strike >= spot) + 10);
  const gexData = gex(show, spot, T, meta.lot);
  const atmIdx = show.findIndex((r) => r.strike === a.atm);
  const greekRows = show.slice(Math.max(0, atmIdx - 6), atmIdx + 7);
  const perp = chain.futures.find((f) => f.name === "Perpetual");
  const ratio = rv && ivAtm ? ivAtm / rv : null;
  const decision = decide({
    spot, T, rows: chain.rows, a, ivAtm: a.atmIV, rv, closes: (daily?.candles ?? []).map((c) => c.c),
    flows: flows ? { fiiNet: flows.fiiNet, diiNet: flows.diiNet } : null,
    funding8h: chain.futures.find((f) => f.name === "Perpetual")?.funding8h ?? null,
    news: newsLean(news.map((n) => n.title), headlineLean), step,
  });
  const biasCls = a.bias === "bullish" ? "good" : a.bias === "bearish" ? "bad" : "none";

  return (
    <>
      <section className={`hero-today ${india ? "" : "crypto"}`}>
        <div className="row between">
          <div>
            <div className="small muted">Options &amp; Futures · {meta.name} · {chain.source} · updated {ago(chain.time)}</div>
            <div className="row" style={{ gap: 12, alignItems: "baseline" }}>
              <div className="big-num">{f0(spot, india ? 2 : 0)}</div>
              {chain.volIndex && <span className="pill">{chain.volIndex.name} {chain.volIndex.value.toFixed(2)}{chain.volIndex.change != null ? ` (${chain.volIndex.change >= 0 ? "+" : ""}${chain.volIndex.change.toFixed(2)})` : ""}</span>}
            </div>
          </div>
          <AutoRefresh seconds={chain.live ? 20 : 60} />
        </div>
        {tabs}
        <div className="fno-expiries">
          {chain.expiries.map((e) => (
            <Link key={e.ts} href={`/fno?u=${u}&e=${e.ts}`} className={e.ts === chain.expiry ? "on" : ""}>{e.label}</Link>
          ))}
        </div>
      </section>

      {!chain.live && <p className="note small" style={{ marginTop: 12 }}>Indian option data comes from the exchange website and runs a few minutes behind. Connect a broker API for tick-by-tick data.</p>}

      <div style={{ marginTop: 12 }}>
        <TodayCall d={decision} cur={cur} name={meta.name} expiryLabel={chain.expiries.find((e) => e.ts === chain.expiry)?.label} />
      </div>

      <div className="grid g4" style={{ marginTop: 12 }}>
        <div className="card tight kpi"><div className="label">Put / Call ratio</div><div className="val">{a.pcr?.toFixed(2) ?? "—"}</div><div className="small muted">by open interest</div></div>
        <div className="card tight kpi"><div className="label">Max pain</div><div className="val">{f0(a.maxPain)}</div><div className={`small ${tone(a.maxPain != null ? a.maxPain - spot : null)}`}>{a.maxPain ? pct(((a.maxPain - spot) / spot) * 100) : ""} vs spot</div></div>
        <div className="card tight kpi"><div className="label">Expected move</div><div className="val">±{f0(a.expectedMove)}</div><div className="small muted">{a.expectedMove ? `±${((a.expectedMove / spot) * 100).toFixed(2)}% by expiry` : ""}</div></div>
        <div className="card tight kpi"><div className="label">ATM IV vs realised</div><div className="val">{ivAtm ? `${(ivAtm * 100).toFixed(1)}%` : "—"}</div><div className={`small ${ratio == null ? "muted" : ratio > 1.15 ? "down" : ratio < 0.9 ? "up" : "muted"}`}>{rv ? `RV ${(rv * 100).toFixed(1)}% · IV/RV ${ratio!.toFixed(2)} ${ratio! > 1.15 ? "(rich)" : ratio! < 0.9 ? "(cheap)" : "(fair)"}` : "realised vol unavailable"}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>What the options say</h2>
          <span className={`pill ${biasCls}`}>Bias: {a.bias}</span>
        </div>
        <ul className="rules" style={{ marginTop: 10 }}>
          {a.reads.map((r, i) => (
            <li key={i}><span className={`mark ${r.tone === "bull" ? "ok" : r.tone === "bear" || r.tone === "warn" ? "no" : ""}`}>{r.tone === "bull" ? "▲" : r.tone === "bear" ? "▼" : r.tone === "warn" ? "!" : "•"}</span><div><span>{r.text}</span></div></li>
          ))}
        </ul>
        <p className="small muted">Positioning, not prediction. Writers defend big OI strikes until news or a trend overwhelms them.</p>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="card-title">Open interest by strike</h3>
          <OIChart rows={show} spot={spot} marks={[{ label: "call wall", strike: a.callWall, color: "#f6465d" }, { label: "put wall", strike: a.putWall, color: "#0ecb81" }, { label: "max pain", strike: a.maxPain, color: "#fbbf24" }]} />
        </div>
        <div className="stack">
          <div className="card">
            <h3 className="card-title">Dealer gamma by strike</h3>
            <GexChart data={gexData} spot={spot} />
            <p className="small muted">Total {a.totalGex >= 0 ? "positive — moves get damped (range)" : "negative — moves get amplified (trend)"}{a.flip ? ` · flip near ${f0(a.flip)}` : ""}.</p>
          </div>
          <div className="card">
            <h3 className="card-title">Volatility smile</h3>
            <SmileChart rows={show} spot={spot} />
            <p className="small muted">Skew {a.skew != null ? `${a.skew >= 0 ? "+" : ""}${a.skew.toFixed(1)} vol pts` : "—"} (5% OTM put IV − 5% OTM call IV).</p>
          </div>
        </div>
      </div>

      <div className="card scroll" style={{ marginTop: 16, padding: 0 }}>
        <div style={{ padding: "14px 14px 0" }}><h3 className="card-title">Option chain &amp; greeks (around the money)</h3></div>
        <table className="tbl greeks">
          <thead>
            <tr><th className="num">OI</th>{india && <th className="num">ΔOI</th>}<th className="num">IV</th><th className="num">Δ</th><th className="num">Γ</th><th className="num">Θ/day</th><th className="num">Vega</th><th className="num">Call</th><th className="strike">Strike</th><th className="num">Put</th><th className="num">Δ</th><th className="num">Θ/day</th><th className="num">IV</th>{india && <th className="num">ΔOI</th>}<th className="num">OI</th></tr>
          </thead>
          <tbody>
            {greekRows.map((r) => {
              const gc = r.callIV ? greeks("call", spot, r.strike, T, r.callIV) : null;
              const gp = r.putIV ? greeks("put", spot, r.strike, T, r.putIV) : null;
              const itmC = r.strike < spot, itmP = r.strike > spot;
              return (
                <tr key={r.strike} className={r.strike === a.atm ? "atm" : ""}>
                  <td className={`num ${itmC ? "itm" : ""}`}>{r.callOI.toLocaleString()}</td>
                  {india && <td className={`num ${tone(r.callOIChg)}`}>{r.callOIChg?.toLocaleString() ?? "—"}</td>}
                  <td className="num">{r.callIV ? (r.callIV * 100).toFixed(1) : "—"}</td>
                  <td className="num">{gc ? gc.delta.toFixed(2) : "—"}</td>
                  <td className="num">{gc ? gc.gamma.toFixed(5) : "—"}</td>
                  <td className="num">{gc ? gc.theta.toFixed(2) : "—"}</td>
                  <td className="num">{gc ? gc.vega.toFixed(2) : "—"}</td>
                  <td className="num"><b>{r.callPrice?.toFixed(2) ?? "—"}</b></td>
                  <td className="strike">{r.strike}</td>
                  <td className="num"><b>{r.putPrice?.toFixed(2) ?? "—"}</b></td>
                  <td className="num">{gp ? gp.delta.toFixed(2) : "—"}</td>
                  <td className="num">{gp ? gp.theta.toFixed(2) : "—"}</td>
                  <td className="num">{r.putIV ? (r.putIV * 100).toFixed(1) : "—"}</td>
                  {india && <td className={`num ${tone(r.putOIChg)}`}>{r.putOIChg?.toLocaleString() ?? "—"}</td>}
                  <td className={`num ${itmP ? "itm" : ""}`}>{r.putOI.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ padding: "0 14px 12px" }}>Greeks: Black-Scholes from each strike&apos;s own IV. Theta per calendar day, vega per 1 vol point. {india ? `OI in contracts (1 lot = ${meta.lot}).` : "OI in coins; prices in USD."}</p>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="card-title">Futures {perp ? "& funding" : ""}</h3>
          {chain.futures.length ? (
            <table className="tbl">
              <thead><tr><th>Contract</th><th className="num">Price</th><th className="num">Basis</th><th className="num">Annualised</th>{perp && <th className="num">Funding 8h</th>}</tr></thead>
              <tbody>
                {chain.futures.slice(0, 7).map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td className="num">{f0(f.price, india ? 1 : 0)}</td>
                    <td className={`num ${tone(f.basisPct)}`}>{f.basisPct != null ? `${f.basisPct >= 0 ? "+" : ""}${f.basisPct.toFixed(2)}%` : "—"}</td>
                    <td className="num">{f.annualisedPct != null ? `${f.annualisedPct.toFixed(1)}%` : "—"}</td>
                    {perp && <td className={`num ${tone(f.funding8h)}`}>{f.funding8h != null ? `${(f.funding8h * 100).toFixed(4)}%` : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small muted">Futures data unavailable from the source right now.</p>
          )}
          <p className="small muted">Positive basis (contango) = longs pay to hold; a high annualised basis or funding means crowded longs.{perp?.funding8h != null ? ` Perpetual funding is ${perp.funding8h > 0 ? "positive — longs pay shorts" : "negative — shorts pay longs"}.` : ""}</p>
        </div>
        {india ? (flows ? <FlowsCard flows={flows} /> : <div className="card"><h3 className="card-title">FII / DII</h3><p className="small muted">NSE did not return today&apos;s FII/DII figures to the server. They publish after market close; broker APIs also provide them.</p></div>) : (
          <div className="card">
            <h3 className="card-title">Crypto positioning</h3>
            <ul className="rules">
              <li><span className="mark">•</span><div><b>Open interest</b><span>{chain.rows.reduce((s, r) => s + r.callOI, 0).toFixed(0)} {u} in calls vs {chain.rows.reduce((s, r) => s + r.putOI, 0).toFixed(0)} {u} in puts this expiry.</span></div></li>
              {chain.volIndex && <li><span className="mark">•</span><div><b>{chain.volIndex.name}</b><span>{chain.volIndex.value.toFixed(1)} — the 30-day implied vol index (crypto&apos;s VIX).</span></div></li>}
              {perp?.funding8h != null && <li><span className={`mark ${perp.funding8h > 0.0003 ? "no" : "ok"}`}>•</span><div><b>Funding</b><span>{(perp.funding8h * 100).toFixed(4)}% per 8h ≈ {(perp.funding8h * 3 * 365 * 100).toFixed(1)}% a year{perp.funding8h > 0.0003 ? " — longs are crowded" : ""}.</span></div></li>}
            </ul>
          </div>
        )}
      </div>

      <h2 className="section-title">Strategies for this expiry</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Built from the live chain and ranked by fit: options {ratio == null ? "—" : ratio > 1.15 ? "are rich, so selling premium ranks higher" : ratio < 0.9 ? "are cheap, so buying premium ranks higher" : "are fairly priced"}; chain bias {a.bias}; dealers {a.totalGex >= 0 ? "long" : "short"} gamma. Figures are per 1 {india ? "unit (× lot size for one lot)" : u}; at expiry; no order is placed.
      </p>
      <div className="strat-grid">
        {strategies.map((s, i) => (
          <div key={s.id} className={`card strat ${i === 0 ? "best" : ""}`}>
            <div className="row between">
              <div><b>{s.name}</b><div className="small muted">{s.view}</div></div>
              <span className={`pill ${s.fit >= 60 ? "confirmed" : s.fit >= 35 ? "watch" : "none"}`}>Fit {s.fit}</span>
            </div>
            <Payoff legs={s.legs} spot={spot} breakevens={s.breakevens} span={(a.expectedMove ?? spot * 0.04) * 2.2} />
            <ul className="legs">
              {s.legs.map((l, j) => <li key={j} className={l.side}>{l.side === "buy" ? "Buy" : "Sell"} {l.strike} {l.type === "call" ? "CE" : "PE"} @ {l.price.toFixed(2)}</li>)}
            </ul>
            <div className="strat-stats">
              <div><span className="label">{s.net >= 0 ? "Credit" : "Debit"}</span><b>{f0(Math.abs(s.net), 2)}</b></div>
              <div><span className="label">Max profit</span><b className="up">{s.maxProfit == null ? "Unlimited" : f0(s.maxProfit, 2)}</b></div>
              <div><span className="label">Max loss</span><b className="down">{s.maxLoss == null ? "Unlimited" : f0(s.maxLoss, 2)}</b></div>
              <div><span className="label">Win prob.</span><b>{(s.pop * 100).toFixed(0)}%</b></div>
              <div><span className="label">Breakeven</span><b>{s.breakevens.map((b) => Math.round(b).toLocaleString()).join(" / ") || "—"}</b></div>
              <div><span className="label">Δ / Θ / Vega</span><b>{s.greeks.delta.toFixed(2)} / {s.greeks.theta.toFixed(2)} / {s.greeks.vega.toFixed(2)}</b></div>
            </div>
            <ul className="why">{s.why.map((w) => <li key={w}>{w}</li>)}</ul>
            <p className="small muted" style={{ margin: 0 }}><b>Manage:</b> {s.manage}</p>
          </div>
        ))}
        {!strategies.length && <p className="small muted">Not enough priced strikes to build strategies for this expiry.</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">Rules-based (algo) playbook</h3>
        <ul className="rules">
          <li><span className="mark ok">1</span><div><b>Delta-neutral premium selling</b><span>Enter a short strangle / iron condor when IV/RV &gt; 1.15, the chain is neutral and dealers are long gamma. Re-hedge with futures when net delta passes ±0.20 per lot. Exit at 50% profit, at 2× the credit lost, or one day before expiry.</span></div></li>
          <li><span className="mark ok">2</span><div><b>Wall fade</b><span>Sell a credit spread with the short strike on the call wall (bearish) or put wall (bullish) when price approaches it with falling momentum. Exit on a close beyond the wall.</span></div></li>
          <li><span className="mark ok">3</span><div><b>Volatility breakout</b><span>Buy a straddle when IV/RV &lt; 0.9 and dealers are short gamma, before a known event (RBI/Fed, CPI, expiry). Exit on a 1-expected-move move or after the event.</span></div></li>
          <li><span className="mark ok">4</span><div><b>Expiry pin</b><span>On expiry day, when max pain is within 0.3% of spot and gamma is positive, an iron butterfly at the max-pain strike. Close by the last hour.</span></div></li>
        </ul>
        <p className="small muted">These are written as exact rules so they can be automated. Placing orders automatically needs a broker API (Zerodha / Upstox / Dhan for India, Deribit keys for crypto) — connect one and they can run with the same checks as your discipline gate.</p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">{meta.name} news</h3>
        {!news.length && <p className="small muted">Headlines unavailable right now.</p>}
        <ul className="news">
          {news.map((n) => {
            const lean = headlineLean(n.title);
            return (
              <li key={n.link}>
                <a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
                <div className="small muted">{n.source} · {ago(n.time)}{lean && <span className={`pill ${lean === "bullish" ? "good" : "bad"}`} style={{ marginLeft: 6 }}>{lean}</span>}</div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>Analysis of positioning and pricing, not investment advice. Options can lose more than the premium when sold; size positions with your risk rules.</p>
    </>
  );
}

function FlowsCard({ flows }: { flows: NonNullable<Awaited<ReturnType<typeof fiiDii>>> }) {
  const cr = (x: number) => `₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  const max = Math.max(1, Math.abs(flows.fiiNet), Math.abs(flows.diiNet));
  const bar = (v: number) => <span className="flow-bar"><i className={v >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(v) / max) * 50}%` }} /></span>;
  return (
    <div className="card">
      <h3 className="card-title">FII / DII cash flows · {flows.date}</h3>
      <div className="flow"><b>FII / FPI</b>{bar(flows.fiiNet)}<b className={tone(flows.fiiNet)}>{flows.fiiNet >= 0 ? "+" : "−"}{cr(flows.fiiNet)}</b></div>
      <div className="small muted">Bought {cr(flows.fiiBuy)} · sold {cr(flows.fiiSell)}</div>
      <div className="flow" style={{ marginTop: 10 }}><b>DII</b>{bar(flows.diiNet)}<b className={tone(flows.diiNet)}>{flows.diiNet >= 0 ? "+" : "−"}{cr(flows.diiNet)}</b></div>
      <div className="small muted">Bought {cr(flows.diiBuy)} · sold {cr(flows.diiSell)}</div>
      <p className="small muted" style={{ marginTop: 10 }}>
        {flows.fiiNet < 0 && flows.diiNet > 0 ? "Foreign money selling, domestic funds absorbing it — markets usually hold up while DIIs keep buying." : flows.fiiNet > 0 && flows.diiNet > 0 ? "Both buying — broad support." : flows.fiiNet > 0 ? "Foreign buying — often lifts large caps and the rupee." : "Both selling — weak session for flows."} Provisional NSE figures, published after the close.
      </p>
    </div>
  );
}
