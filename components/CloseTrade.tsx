"use client";
import { useActionState } from "react";
import { closeTrade, type FormState } from "@/app/actions";

export default function CloseTrade({ id, suggested }: { id: string; suggested: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeTrade, null);
  return (
    <form action={action} className="stack" style={{ marginTop: 10 }}>
      <input type="hidden" name="id" value={id} />
      <div className="grid g3">
        <label className="f">
          <span>Exit price</span>
          <input type="number" name="exit_price" step="any" min="0" required defaultValue={suggested ?? undefined} />
        </label>
        <label className="f">
          <span>Did you exit at your stop or target, without moving them?</span>
          <select name="followed_plan" required defaultValue="">
            <option value="" disabled>Choose…</option>
            <option value="yes">Yes, as planned</option>
            <option value="no">No, I exited early / held on</option>
          </select>
        </label>
        <label className="f">
          <span>Lesson (one line)</span>
          <input type="text" name="lesson" maxLength={1000} />
        </label>
      </div>
      <button className="btn" disabled={pending}>{pending ? "…" : "Close trade"}</button>
      {state && <p className={`note small ${state.ok ? "good" : "bad"}`}>{state.message}</p>}
    </form>
  );
}
