"use client";

import { useEffect, useState } from "react";

type Ev = { id: string; text: string; grade: string };

const KEY = "sweep-alerts-seen";

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((d) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + d);
      o.stop(ctx.currentTime + d + 0.16);
    });
  } catch {
    // audio blocked until the user interacts with the page — the banner still shows
  }
}

/**
 * Pops a banner, a sound and (if allowed) a system notification the first time
 * a NY sweep event appears. Works while the app is open — including the
 * installed app in the foreground — because the page re-checks every refresh.
 */
export default function SweepAlert({ events }: { events: Ev[] }) {
  const [fresh, setFresh] = useState<Ev[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {}
    const first = seen.length === 0 && !localStorage.getItem(KEY + "-init");
    const news = events.filter((e) => !seen.includes(e.id));
    try {
      localStorage.setItem(KEY, JSON.stringify([...seen, ...news.map((e) => e.id)].slice(-100)));
      localStorage.setItem(KEY + "-init", "1");
    } catch {}
    if (!news.length || first) return; // don't fire for everything on the very first visit
    setFresh(news);
    beep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const e of news) new Notification(`XAU sweep · grade ${e.grade}`, { body: e.text, icon: "/icon-192.png", tag: e.id });
    }
  }, [events]);

  return (
    <>
      {!!fresh.length && (
        <div className="alert-pop" role="alert">
          <b>⚡ New NY sweep</b>
          {fresh.map((e) => <div key={e.id} className="small">{e.text}</div>)}
          <button className="btn small" onClick={() => setFresh([])}>Got it</button>
        </div>
      )}
      {perm === "default" && (
        <button className="btn small" onClick={() => Notification.requestPermission().then(setPerm)}>🔔 Enable sweep alerts</button>
      )}
      {perm === "granted" && <span className="pill good">🔔 Alerts on</span>}
      {perm === "denied" && <span className="pill none" title="Allow notifications for this site in your browser settings">🔕 Alerts blocked</span>}
    </>
  );
}
