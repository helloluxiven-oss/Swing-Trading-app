"use client";

// Keeps a page live: re-fetches its server data on an interval while the tab is
// visible, and immediately when you come back to the tab. The server side caches
// quotes for about a minute, so this cannot hammer the data source.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    setAt(new Date());
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setAt(new Date());
      }
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);

  return (
    <span className="pill small" title={`Refreshes every ${seconds}s while this tab is open`}>
      <i style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--up)", display: "inline-block" }} />
      Live{at ? ` · ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
    </span>
  );
}
