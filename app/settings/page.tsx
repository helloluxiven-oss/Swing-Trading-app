import { getSettings } from "@/lib/data";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <>
      <h1>Your rules</h1>
      <p className="sub">The gate enforces these. Change them here, calmly — not in the middle of a trade.</p>
      <SettingsForm s={s} />
      <div className="card" style={{ marginTop: 16 }}>
        <h2>What changed from the original sheet</h2>
        <ul className="rules">
          <li><span className="mark ok">+</span><div><b>Market filter</b><span>Longs only when NIFTY 50 / S&amp;P 500 is above its 50 EMA, shorts only when below. The sheet checked the stock&apos;s trend but not the market&apos;s.</span></div></li>
          <li><span className="mark ok">+</span><div><b>Relative strength</b><span>A setup is only “confirmed” if the stock beat its index over ~3 months (or lagged it, for shorts).</span></div></li>
          <li><span className="mark ok">+</span><div><b>ATR-aware stop</b><span>The swing stop is pushed out to at least one day&apos;s normal movement, so noise does not stop you out — the 19-08 lesson.</span></div></li>
          <li><span className="mark ok">+</span><div><b>Completed candles only</b><span>Setups are read from the last closed daily candle, so they cannot flicker during the session and tempt an early entry.</span></div></li>
          <li><span className="mark no">−</span><div><b>“BUY FOCUS” near the 52-week low — dropped</b><span>It told you to buy weakness while the Indicator Setup says buy strength above the 50 EMA. The 52-week position is still shown, as context only.</span></div></li>
          <li><span className="mark no">−</span><div><b>FO screener “NEAR LOW” — fixed</b><span>The sheet compared each stock to the next row&apos;s 52-week low. Here each stock uses its own.</span></div></li>
        </ul>
      </div>
    </>
  );
}
