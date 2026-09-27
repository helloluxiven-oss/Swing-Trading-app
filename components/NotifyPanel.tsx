"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { removePushSubscription, saveAlertPrefs, savePushSubscription, sendTestAlert, type FormState } from "@/app/actions";

type Prefs = { enabled: boolean; sweeps: boolean; setups: boolean; stocks: boolean; min_grade: "A" | "B" | "C"; weekend_crypto: boolean; quiet_start: string; quiet_end: string };
type Device = { endpoint: string; device: string | null; created_at: string };
type Log = { key: string; title: string; body: string; sent_at: string };

function key(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "Browser";
  const app = window.matchMedia("(display-mode: standalone)").matches ? " (app)" : "";
  return `${os} · ${br}${app}`;
}

export default function NotifyPanel({ vapidPublic, prefs, devices, log }: { vapidPublic: string | null; prefs: Prefs; devices: Device[]; log: Log[] }) {
  const [support, setSupport] = useState<"checking" | "ok" | "ios-install" | "no">("checking");
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [mine, setMine] = useState<string | null>(null);
  const [msg, setMsg] = useState<FormState>(null);
  const [busy, start] = useTransition();
  const [state, action, saving] = useActionState<FormState, FormData>(saveAlertPrefs, null);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setSupport(ios && !standalone ? "ios-install" : "no");
      return;
    }
    setSupport("ok");
    setPerm(Notification.permission);
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setMine(s?.endpoint ?? null)).catch(() => {});
  }, []);

  const on = !!mine && devices.some((d) => d.endpoint === mine);

  const enable = () =>
    start(async () => {
      setMsg(null);
      if (!vapidPublic) return setMsg({ ok: false, message: "Push keys are not ready yet. Reload this page." });
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return setMsg({ ok: false, message: "Notifications are blocked for this site. Allow them in your browser / phone settings, then try again." });
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(vapidPublic) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await savePushSubscription(j, deviceName());
      setMsg(r);
      if (r?.ok) setMine(j.endpoint);
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.getSubscription();
      if (s) {
        await removePushSubscription(s.endpoint);
        await s.unsubscribe();
      }
      setMine(null);
      setMsg({ ok: true, message: "This device won't get alerts any more." });
    });

  return (
    <div className="stack">
      <div className={`note ${on ? "good" : ""}`}>
        {support === "checking" ? (
          "Checking this device…"
        ) : support === "ios-install" ? (
          <>
            <b>iPhone: install the app first.</b> Apple only allows notifications from apps on the home screen. Tap <b>Share → Add to Home Screen</b>, open SIGMORA from your home screen, then come back here.
          </>
        ) : support === "no" ? (
          "This browser can't receive push notifications. Use Chrome, Edge, Safari 16.4+ or the installed app."
        ) : on ? (
          <><b>🔔 This device gets live alerts.</b> They arrive even when the app is closed.</>
        ) : (
          <><b>This device is not getting alerts yet.</b> Turn it on to get NY sweeps and ready setups for your favourites as they happen.</>
        )}
      </div>

      {support === "ok" && (
        <div className="row">
          {on ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => start(async () => setMsg(await sendTestAlert()))}>Send a test notification</button>
              <button className="btn" disabled={busy} onClick={disable}>Turn off on this device</button>
            </>
          ) : (
            <button className="btn primary" disabled={busy || perm === "denied"} onClick={enable}>🔔 Turn on notifications on this device</button>
          )}
          {perm === "denied" && <span className="small muted">Blocked in browser settings — allow notifications for this site first.</span>}
        </div>
      )}
      {msg && <p className={`small ${msg.ok ? "up" : "down"}`}>{msg.message}</p>}

      <form action={action} className="stack">
        <label className="toggle"><input type="checkbox" name="enabled" defaultChecked={prefs.enabled} /><span><b>Live alerts</b><em>Master switch for every device</em></span></label>
        <div className="grid g3">
          <label className="toggle"><input type="checkbox" name="sweeps" defaultChecked={prefs.sweeps} /><span><b>NY sweeps</b><em>XAU, forex, crypto favourites — a liquidity pool taken in New York</em></span></label>
          <label className="toggle"><input type="checkbox" name="setups" defaultChecked={prefs.setups} /><span><b>Setup ready</b><em>Structure shift confirmed — entry, stop and targets in the alert</em></span></label>
          <label className="toggle"><input type="checkbox" name="stocks" defaultChecked={prefs.stocks} /><span><b>Stock setups</b><em>A favourite stock&apos;s swing setup becomes ready or confirmed</em></span></label>
        </div>
        <div className="grid g3">
          <label className="f"><span>Only grades at or above</span>
            <select name="min_grade" defaultValue={prefs.min_grade}>
              <option value="A">A only — fewest, cleanest</option>
              <option value="B">B and A (recommended)</option>
              <option value="C">Everything</option>
            </select>
          </label>
          <label className="f"><span>Quiet from (your time)</span><input type="time" name="quiet_start" defaultValue={prefs.quiet_start} /></label>
          <label className="f"><span>Quiet until</span><input type="time" name="quiet_end" defaultValue={prefs.quiet_end} /></label>
        </div>
        <label className="toggle"><input type="checkbox" name="weekend_crypto" defaultChecked={prefs.weekend_crypto} /><span><b>Crypto alerts at weekends</b><em>Off by default — weekend liquidity is thin and sweeps mean less</em></span></label>
        <div className="row">
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save alert settings"}</button>
          {state && <span className={`small ${state.ok ? "up" : "down"}`}>{state.message}</span>}
        </div>
      </form>

      {!!devices.length && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Devices getting alerts</div>
          <ul className="devices">
            {devices.map((d) => (
              <li key={d.endpoint}>
                <span>{d.device ?? "Device"}{d.endpoint === mine ? <b className="up"> · this one</b> : ""}</span>
                <span className="small muted">since {new Date(d.created_at).toLocaleDateString()}</span>
                <button className="btn small" onClick={() => start(async () => { await removePushSubscription(d.endpoint); if (d.endpoint === mine) setMine(null); })}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="label" style={{ marginBottom: 6 }}>Recent alerts</div>
        {log.length ? (
          <ul className="news">
            {log.map((l) => (
              <li key={l.key}>
                <b>{l.title}</b>
                <div className="small muted">{l.body}</div>
                <div className="small muted">{new Date(l.sent_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">None yet. Alerts are checked every minute on your favourites.</p>
        )}
      </div>
    </div>
  );
}
