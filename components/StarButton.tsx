"use client";
import { useState, useTransition } from "react";
import { toggleWatch } from "@/app/actions";
import type { Market } from "@/lib/plan";

export default function StarButton({ symbol, market, starred }: { symbol: string; market: Market; starred: boolean }) {
  const [on, setOn] = useState(starred);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`star ${on ? "on" : ""}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from favourites` : `Add ${symbol} to favourites`}
      title={on ? "In your focus list" : "Pin to your focus list"}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOn(!on);
        start(async () => setOn(await toggleWatch(symbol, market)));
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
