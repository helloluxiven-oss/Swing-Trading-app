"use client";

import { useState } from "react";

/** Company logo on a white tile; falls back to a ticker badge when there is none. */
export default function Logo({ symbol, market, size = 32 }: { symbol: string; market: "IN" | "US"; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (failed) {
    return (
      <span className="logo logo-fallback" style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.3)) }} aria-hidden="true">
        {symbol.replace(/[^A-Z0-9]/gi, "").slice(0, 4)}
      </span>
    );
  }
  return (
    <span className="logo" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/logo/${market}/${encodeURIComponent(symbol)}`} alt="" loading="lazy" width={size} height={size} onError={() => setFailed(true)} />
    </span>
  );
}
