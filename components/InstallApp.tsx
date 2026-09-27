"use client";

// Registers the service worker and offers "Install app".
// Android / desktop Chrome: a real install button (beforeinstallprompt).
// iPhone: Safari has no install button for web apps, so we show the two taps.

import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function InstallApp() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
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

  if (installed || (!evt && !ios)) return null;

  if (evt) {
    return (
      <button
        className="btn small install"
        onClick={async () => {
          await evt.prompt();
          await evt.userChoice;
          setEvt(null);
        }}
      >
        ⬇ Install app
      </button>
    );
  }

  return (
    <>
      <button className="btn small install" onClick={() => setShowIos(!showIos)}>⬇ Install app</button>
      {showIos && (
        <div className="ios-hint" role="dialog" aria-label="Install on iPhone" onClick={() => setShowIos(false)}>
          <div className="card stack" onClick={(e) => e.stopPropagation()}>
            <b>Install on iPhone</b>
            <ol style={{ paddingLeft: 18, color: "var(--ink-2)" }}>
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap the <b>Share</b> button (square with an arrow).</li>
              <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </ol>
            <button className="btn" onClick={() => setShowIos(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
