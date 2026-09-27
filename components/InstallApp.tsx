"use client";

// Registers the service worker and always offers "Install app" until the app
// is installed. Chrome's own install prompt is used when the browser offers
// it; otherwise the button shows the exact taps for this phone and browser,
// because Chrome often withholds the prompt (e.g. after one dismissal) and
// in-app browsers (WhatsApp, Instagram, Gmail) can't install at all.

import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Platform = "ios-safari" | "ios-other" | "android-chrome" | "android-samsung" | "in-app" | "desktop";

function detect(): Platform {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|GSA\/|wv\)/i.test(ua)) return "in-app";
  if (/iphone|ipad|ipod/i.test(ua)) return /CriOS|FxiOS|EdgiOS/i.test(ua) ? "ios-other" : "ios-safari";
  if (/android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? "android-samsung" : "android-chrome";
  return "desktop";
}

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  "ios-safari": { title: "Install on iPhone", steps: ["Tap the Share button (square with an arrow) at the bottom.", "Scroll and tap Add to Home Screen.", "Tap Add. Open it from your home screen."] },
  "ios-other": { title: "Install on iPhone", steps: ["Tap the Share button (top right or bottom).", "Tap Add to Home Screen, then Add.", "If you don't see it, open this page in Safari and do the same."] },
  "android-chrome": { title: "Install on Android", steps: ["Tap the ⋮ menu (top right) in Chrome.", "Tap Install app (or Add to Home screen).", "Tap Install. Open it from your home screen or app drawer."] },
  "android-samsung": { title: "Install on Samsung Internet", steps: ["Tap the ≡ menu at the bottom.", "Tap Add page to → Home screen.", "Tap Add."] },
  "in-app": { title: "Open in your browser first", steps: ["This is an in-app browser (WhatsApp, Instagram, Gmail…) — it can't install apps.", "Tap ⋮ or ••• and choose Open in Chrome / Open in Safari.", "Then tap Install app again."] },
  desktop: { title: "Install on this computer", steps: ["In Chrome or Edge, click the install icon at the right of the address bar.", "Or open the ⋮ menu → Install SIGMORA Swing Desk."] },
};

export default function InstallApp() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installed, setInstalled] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setPlatform(detect());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !platform) return null;
  const help = STEPS[platform];

  return (
    <>
      <button
        className="btn small install"
        onClick={async () => {
          if (evt) {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
          } else setOpen(true);
        }}
      >
        ⬇ <span>Install app</span>
      </button>
      {open && (
        <div className="ios-hint" role="dialog" aria-label={help.title} onClick={() => setOpen(false)}>
          <div className="card stack" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ gap: 10 }}>
              <img src="/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
              <div><b>{help.title}</b><div className="small muted">Works offline, opens full-screen like a normal app.</div></div>
            </div>
            <ol style={{ paddingLeft: 18, color: "var(--ink-2)", lineHeight: 1.6 }}>
              {help.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <button className="btn primary" onClick={() => setOpen(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
