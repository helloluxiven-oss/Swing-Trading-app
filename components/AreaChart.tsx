"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, LineSeries, type UTCTimestamp } from "lightweight-charts";

/** A clean area chart of closing prices, optionally with a 20-day average line. */
export default function AreaChart({ t, c, height = 180, showAvg = true }: { t: number[]; c: number[]; height?: number; showAvg?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || c.length < 2) return;
    const up = c[c.length - 1] >= c[0];
    const col = up ? "#22c55e" : "#f43f5e";
    const chart = createChart(el.current, {
      localization: { locale: "en-US" },
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8aa6", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { vertLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" }, horzLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" } },
      handleScroll: false,
      handleScale: false,
    });
    const s = chart.addSeries(AreaSeries, {
      lineColor: col,
      topColor: up ? "rgba(34,197,94,0.30)" : "rgba(244,63,94,0.30)",
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
      priceLineVisible: false,
    });
    s.setData(c.map((v, i) => ({ time: t[i] as UTCTimestamp, value: v })));
    if (showAvg && c.length > 20) {
      const avg = chart.addSeries(LineSeries, { color: "#b39dfb", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      avg.setData(c.flatMap((_, i) => (i < 19 ? [] : [{ time: t[i] as UTCTimestamp, value: c.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 }])));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [t, c, showAvg]);
  return <div ref={el} style={{ height, width: "100%" }} />;
}
