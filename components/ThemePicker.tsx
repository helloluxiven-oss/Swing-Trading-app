"use client";
import { THEMES, useChartTheme, saveTheme, type ThemeName } from "./chart/annotations";

/** Pick the chart background; remembered on this device. */
export default function ThemePicker() {
  const [t] = useChartTheme();
  return (
    <div className="theme-pick">
      {(Object.keys(THEMES) as ThemeName[]).map((k) => {
        const th = THEMES[k];
        return (
          <button key={k} type="button" className={`theme-swatch ${t.name === k ? "on" : ""}`} onClick={() => saveTheme(k)} aria-pressed={t.name === k}>
            <span className="sw" style={{ background: th.bg }}>
              <i style={{ background: th.up, height: 18 }} /><i style={{ background: th.down, height: 11 }} /><i style={{ background: th.up, height: 24 }} /><i style={{ background: th.up, height: 15 }} />
            </span>
            <b>{th.label}</b>
          </button>
        );
      })}
    </div>
  );
}
