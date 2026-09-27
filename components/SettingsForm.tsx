"use client";
import { useActionState } from "react";
import { saveSettings, type FormState } from "@/app/actions";
import type { AppSettings } from "@/lib/data";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SettingsForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, null);
  return (
    <form action={action} className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Money and risk</h2>
        <div className="grid g4">
          <label className="f"><span>Trading capital, India (₹)</span><input type="number" name="capital_inr" min="0" step="any" defaultValue={s.capitalInr} required /></label>
          <label className="f"><span>Trading capital, US ($)</span><input type="number" name="capital_usd" min="0" step="any" defaultValue={s.capitalUsd} required /></label>
          <label className="f"><span>Risk per trade (% of capital)</span><input type="number" name="risk_pct" min="0.1" max="5" step="0.1" defaultValue={s.riskPct} required /></label>
          <label className="f"><span>Reward : risk (2 = 1:2)</span><input type="number" name="rr" min="1" max="5" step="0.5" defaultValue={s.rr} required /></label>
        </div>
        <div className="grid g2">
          <label className="f"><span>Stop-loss method</span>
            <select name="stop_mode" defaultValue={s.stopMode}>
              <option value="smart">Smart: swing low/high, never closer than 1 ATR (recommended)</option>
              <option value="swing">Swing low/high only (the original sheet)</option>
              <option value="fixed">Fixed percentage</option>
            </select>
          </label>
          <label className="f"><span>Fixed stop % (only for the fixed method)</span><input type="number" name="fixed_stop_pct" min="0.5" max="10" step="0.1" defaultValue={s.fixedStopPct} required /></label>
        </div>
        <p className="small muted">1% risk means a loss at the stop costs 1% of that market&apos;s capital. Your journal lost 40 in a single day twice; this is what prevents that.</p>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Discipline</h2>
        <div className="grid g4">
          <label className="f"><span>Office hours start</span><input type="time" name="office_start" defaultValue={s.officeStart} required /></label>
          <label className="f"><span>Office hours end</span><input type="time" name="office_end" defaultValue={s.officeEnd} required /></label>
          <label className="f"><span>Time zone</span><input type="text" name="timezone" defaultValue={s.timezone} required /></label>
          <label className="f"><span>Stop for the day after N losses in a row</span><input type="number" name="max_consecutive_losses" min="1" max="10" defaultValue={s.maxConsecutiveLosses} required /></label>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Working days (no trades logged during office hours on these days)</div>
          <div className="row">
            {DAYS.map((d, i) => (
              <label key={d} className="pill" style={{ cursor: "pointer" }}>
                <input type="checkbox" name="office_days" value={i + 1} defaultChecked={s.officeDays.includes(i + 1)} /> {d}
              </label>
            ))}
          </div>
        </div>
      </div>

      <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save rules"}</button>
      {state && <p className={`note ${state.ok ? "good" : "bad"}`}>{state.message}</p>}
    </form>
  );
}
