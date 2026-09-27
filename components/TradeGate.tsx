"use client";

// The gate, shown live as you answer. The same checks run again on the server
// when you press the button — this preview only saves you the round trip.

import { useActionState, useEffect, useState } from "react";
import { takeTrade, type FormState } from "@/app/actions";
import { runGate, type Settings, type RecentTrade, type Emotions } from "@/lib/gate";
import type { Plan, Market } from "@/lib/plan";
import type { Side, Status } from "@/lib/setup";
import { money, qtyFmt } from "@/lib/format";

type SideInfo = { status: Status; withTrend: boolean; plan: Plan };

const QUESTIONS: [keyof Emotions, string][] = [
  ["fomo", "Am I entering because I'm afraid of missing the move?"],
  ["revenge", "Am I trying to win back a loss?"],
  ["fear", "Am I scared of this trade?"],
  ["greed", "Am I sizing up or planning to move the target for more?"],
];

export default function TradeGate({
  symbol,
  market,
  sides,
  defaultSide,
  settings,
  recentClosed,
}: {
  symbol: string;
  market: Market;
  sides: Record<Side, SideInfo>;
  defaultSide: Side;
  settings: Settings;
  recentClosed: RecentTrade[];
}) {
  const [side, setSide] = useState<Side>(defaultSide);
  const [answers, setAnswers] = useState<Record<keyof Emotions, "yes" | "no" | "">>({ fomo: "", revenge: "", fear: "", greed: "" });
  const [state, action, pending] = useActionState<FormState, FormData>(takeTrade, null);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const info = sides[side];
  const p = info.plan;
  const answered = Object.values(answers).every((v) => v !== "");
  const gate = now
    ? runGate({
        now,
        settings,
        setupStatus: info.status,
        withTrend: info.withTrend,
        emotions: { fomo: answers.fomo === "yes", revenge: answers.revenge === "yes", fear: answers.fear === "yes", greed: answers.greed === "yes" },
        recentClosed,
        hasStopAndTarget: p.qty > 0,
      })
    : null;
  const allowed = !!gate?.allowed && answered;

  return (
    <form action={action} className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Take this trade?</h2>
        <div className="seg" role="radiogroup" aria-label="Side">
          {(["long", "short"] as Side[]).map((s) => (
            <label key={s}>
              <input type="radio" name="side" value={s} checked={side === s} onChange={() => setSide(s)} />
              <span>{s === "long" ? "Buy (long)" : "Sell (short)"}</span>
            </label>
          ))}
        </div>
      </div>
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="market" value={market} />

      <div className="grid g4">
        <div><div className="small muted">Entry above</div><b>{money(p.entry, market)}</b></div>
        <div><div className="small muted">Stop-loss</div><b className="down">{money(p.stop, market)}</b> <span className="small muted">({p.stopPct}%)</span></div>
        <div><div className="small muted">Target</div><b className="up">{money(p.target, market)}</b></div>
        <div><div className="small muted">Size</div><b>{qtyFmt(p.qty)}</b> <span className="small muted">shares</span></div>
      </div>
      <p className="small muted">
        Risking {money(p.maxLoss, market)} to make {money(p.maxGain, market)}. Uses {money(p.capitalUsed, market)} of capital
        {p.cappedByCapital ? " — capped by your capital, not your risk budget" : ""}. At {money(p.breakevenAt, market)} (+1R), move the stop to entry.
      </p>
      {p.warnings.map((w) => <p key={w} className="note warn small">{w}</p>)}

      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>Answer honestly. Any “yes” blocks the trade.</div>
        {QUESTIONS.map(([k, q]) => (
          <div key={k} className="yn">
            <span>{q}</span>
            <div className="seg">
              {(["no", "yes"] as const).map((v) => (
                <label key={v}>
                  <input type="radio" name={k} value={v} checked={answers[k] === v} onChange={() => setAnswers({ ...answers, [k]: v })} required />
                  <span>{v === "no" ? "No" : "Yes"}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {gate && (
        <ul className="rules">
          {gate.checks.map((c) => (
            <li key={c.id}>
              <span className={`mark ${c.pass ? "ok" : "no"}`}>{c.pass ? "✓" : "✕"}</span>
              <div><b>{c.label}</b>{!c.pass && <span>{c.why}</span>}</div>
            </li>
          ))}
        </ul>
      )}

      <label className="f">
        <span>Plan note (optional): why this trade, what would make you wrong</span>
        <textarea name="note" maxLength={500} />
      </label>

      <button className="btn primary" disabled={!allowed || pending}>
        {pending ? "Checking again on the server…" : allowed ? `Log the plan: ${side === "long" ? "buy" : "sell"} ${symbol}` : answered ? "Blocked by your rules" : "Answer the four questions"}
      </button>
      <p className="small muted">
        This logs your plan in the journal with the stop-loss and target locked. It does not place an order with any broker.
      </p>
      {state && !state.ok && (
        <div className="note bad">
          {state.message}
          {state.checks && (
            <ul style={{ marginTop: 6, paddingLeft: 18 }}>
              {state.checks.filter((c) => !c.pass).map((c) => <li key={c.id}>{c.label}: {c.why}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
