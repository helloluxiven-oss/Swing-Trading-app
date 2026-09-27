"use client";
import { useActionState } from "react";
import { addHolding, type FormState } from "@/app/actions";

export default function AddHolding() {
  const [state, action, pending] = useActionState<FormState, FormData>(addHolding, null);
  return (
    <form action={action} className="card stack">
      <h2 style={{ margin: 0 }}>Add a holding</h2>
      <div className="grid g4">
        <label className="f"><span>Symbol</span><input type="text" name="symbol" required placeholder="NVDA or RELIANCE" /></label>
        <label className="f"><span>Market</span>
          <select name="market" defaultValue="US"><option value="US">US</option><option value="IN">India (NSE)</option></select>
        </label>
        <label className="f"><span>Quantity</span><input type="number" name="qty" step="any" min="0" required /></label>
        <label className="f"><span>Average price</span><input type="number" name="avg_price" step="any" min="0" required /></label>
      </div>
      <div className="grid g2">
        <label className="f"><span>Bought on</span><input type="date" name="bought_on" /></label>
        <label className="f"><span>Sector</span><input type="text" name="sector" /></label>
      </div>
      <button className="btn" disabled={pending}>{pending ? "…" : "Add"}</button>
      {state && <p className={`note small ${state.ok ? "good" : "bad"}`}>{state.message}</p>}
    </form>
  );
}
