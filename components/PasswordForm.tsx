"use client";
import { useActionState } from "react";
import { changePassword, type FormState } from "@/app/actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, null);
  return (
    <form action={action} className="stack" autoComplete="on">
      <div className="grid g3">
        <label className="f"><span>Current password</span><input type="password" name="current" autoComplete="current-password" required /></label>
        <label className="f"><span>New password (10+ characters)</span><input type="password" name="next" autoComplete="new-password" minLength={10} required /></label>
        <label className="f"><span>New password again</span><input type="password" name="confirm" autoComplete="new-password" minLength={10} required /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Changing…" : "Change password"}</button>
        {state && <span className={`small ${state.ok ? "up" : "down"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
