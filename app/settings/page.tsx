import { getAlertSetup, getSettings } from "@/lib/data";
import { db } from "@/lib/supabase/server";
import { ensurePushKeys, DEFAULT_PREFS } from "@/lib/alerts";
import { signOutEverywhere } from "../actions";
import SettingsForm from "@/components/SettingsForm";
import NotifyPanel from "@/components/NotifyPanel";
import PasswordForm from "@/components/PasswordForm";
import ThemePicker from "@/components/ThemePicker";

export const dynamic = "force-dynamic";

const SECTIONS = [
  ["alerts", "🔔 Notifications"],
  ["rules", "⚖️ Trading rules"],
  ["look", "🎨 Chart look"],
  ["account", "🔐 Account"],
  ["data", "📦 Your data"],
  ["sources", "📡 Data sources"],
] as const;

export default async function SettingsPage() {
  const supabase = await db();
  const [s, alerts, { data: u }, vapid] = await Promise.all([getSettings(), getAlertSetup(), supabase.auth.getUser(), ensurePushKeys(supabase)]);
  const oanda = !!process.env.OANDA_TOKEN;

  return (
    <>
      <section className="hero-today">
        <h1 style={{ margin: 0 }}>Settings</h1>
        <p className="sub" style={{ margin: "4px 0 10px" }}>Notifications, your trading rules, how charts look, your account and your data.</p>
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
      </section>

      <section id="alerts" className="card set-card">
        <h2>🔔 Live notifications</h2>
        <p className="small muted">Checked every minute on your favourites, on the server — they reach your phone even when the app is closed.</p>
        <NotifyPanel vapidPublic={vapid} prefs={{ ...DEFAULT_PREFS, ...(alerts.prefs ?? {}) }} devices={alerts.devices} log={alerts.log} />
      </section>

      <section id="rules" className="set-card">
        <h2 style={{ marginTop: 20 }}>⚖️ Trading rules</h2>
        <p className="small muted" style={{ marginBottom: 10 }}>Position size and the discipline gate come from these. Change them calmly — never in the middle of a trade.</p>
        <SettingsForm s={s} />
      </section>

      <section id="look" className="card set-card" style={{ marginTop: 16 }}>
        <h2>🎨 Chart look</h2>
        <p className="small muted">Background and candle colours for every chart. Saved on this device.</p>
        <ThemePicker />
      </section>

      <section id="account" className="card set-card" style={{ marginTop: 16 }}>
        <h2>🔐 Account</h2>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div><div className="label">Signed in as</div><b>{u.user?.email}</b></div>
          <div className="small muted">Last sign-in {u.user?.last_sign_in_at ? new Date(u.user.last_sign_in_at).toLocaleString("en-GB", { timeZone: s.timezone }) : "—"}</div>
        </div>
        <h3 className="card-title">Change password</h3>
        <PasswordForm />
        <h3 className="card-title" style={{ marginTop: 18 }}>Lost a phone?</h3>
        <form action={signOutEverywhere} className="row">
          <button className="btn danger">Sign out on every device</button>
          <span className="small muted">Every browser and installed app has to sign in again.</span>
        </form>
      </section>

      <section id="data" className="card set-card" style={{ marginTop: 16 }}>
        <h2>📦 Your data</h2>
        <p className="small muted">Download everything you logged — open it in Excel or Google Sheets.</p>
        <div className="row">
          <a className="btn" href="/api/export/trades">⬇ Trade journal (CSV)</a>
          <a className="btn" href="/api/export/holdings">⬇ Portfolio holdings (CSV)</a>
        </div>
      </section>

      <section id="sources" className="card set-card" style={{ marginTop: 16 }}>
        <h2>📡 Data sources</h2>
        <ul className="rules">
          <li><span className={`mark ${oanda ? "ok" : "no"}`}>{oanda ? "✓" : "·"}</span><div><b>OANDA — XAU, forex, oil (real-time)</b><span>{oanda ? "Connected. Forex & commodities use OANDA spot prices." : "Not connected — forex & commodities use Yahoo (delayed). Add OANDA_TOKEN in Vercel → Settings → Environment Variables (a free practice-account token is enough), then redeploy."}</span></div></li>
          <li><span className="mark ok">✓</span><div><b>Kraken — crypto (real-time)</b><span>BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK, LTC. BNB comes from Yahoo.</span></div></li>
          <li><span className="mark ok">✓</span><div><b>Yahoo Finance — stocks and fallback</b><span>US near real-time; NSE about 15 minutes behind on the free feed.</span></div></li>
          <li><span className="mark ok">✓</span><div><b>News &amp; calendar</b><span>Google News headlines and the Forex Factory economic calendar.</span></div></li>
        </ul>
        <details style={{ marginTop: 12 }}>
          <summary className="small muted">What changed from the original sheet</summary>
          <ul className="rules" style={{ marginTop: 10 }}>
            <li><span className="mark ok">+</span><div><b>Market filter</b><span>Longs only when NIFTY 50 / S&amp;P 500 is above its 50 EMA, shorts only when below.</span></div></li>
            <li><span className="mark ok">+</span><div><b>Relative strength</b><span>A setup is only “confirmed” if the stock beat its index over ~3 months.</span></div></li>
            <li><span className="mark ok">+</span><div><b>ATR-aware stop</b><span>The swing stop is pushed out to at least one day&apos;s normal movement.</span></div></li>
            <li><span className="mark ok">+</span><div><b>Completed candles only</b><span>Setups are read from closed candles, so they cannot flicker during the session.</span></div></li>
            <li><span className="mark ok">+</span><div><b>52-week focus kept as a separate lens</b><span>Your Buy/Sell Focus near the 52-week low/high is on the dashboard, flagged when it fights the trend.</span></div></li>
          </ul>
        </details>
      </section>
    </>
  );
}
