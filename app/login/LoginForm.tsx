"use client";
import { useActionState, useState } from "react";
import { signIn, type FormState } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="mode" value={mode} />
      <label className="f">
        <span>Email</span>
        <input type="email" name="email" required autoComplete="email" />
      </label>
      <label className="f">
        <span>Password</span>
        <input type="password" name="password" required minLength={10} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
      </label>
      <button className="btn primary" disabled={pending} style={{ width: "100%" }}>
        {pending ? "…" : mode === "signin" ? "Sign in" : "Create my account"}
      </button>
      {state && <p className={`note ${state.ok ? "good" : "bad"}`}>{state.message}</p>}
      <button type="button" className="btn small" style={{ width: "100%" }} onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "First time? Create the account" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
