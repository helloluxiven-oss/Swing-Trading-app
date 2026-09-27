import type { Rule } from "@/lib/setup";

const REQUIRED = new Set(["trend", "pullback", "rsi", "candle", "market"]);

/** One square per rule, in order. Filled green when it passes; required rules show red when they fail. */
export default function RuleDots({ rules }: { rules: Rule[] }) {
  return (
    <span className="dots" aria-label={rules.map((r) => `${r.label}: ${r.pass ? "pass" : "fail"}`).join("; ")}>
      {rules.map((r) => (
        <i
          key={r.id}
          title={`${r.label} — ${r.pass ? "pass" : "fail"}`}
          className={`dot ${r.pass ? "on" : "off"} ${REQUIRED.has(r.id) ? "req" : ""}`}
        />
      ))}
    </span>
  );
}
