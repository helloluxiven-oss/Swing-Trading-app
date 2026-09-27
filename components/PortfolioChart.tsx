"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import type { HistoryPoint } from "@/lib/portfolio";

const RANGES = [
  ["1M", 30],
  ["3M", 91],
  ["6M", 182],
  ["1Y", 365],
  ["All", 0],
] as const;

const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;

/** Portfolio value (area) vs money put in (step line) vs the same money in the index (dashed). */
export default function PortfolioChart({ points, height = 320 }: { points: HistoryPoint[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("All");
  const [hover, setHover] = useState<HistoryPoint | null>(null);
  const shown = hover ?? points[points.length - 1];

  useEffect(() => {
    if (!el.current || points.length < 2) return;
    const last = points[points.length - 1];
    const up = last.value >= last.invested;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8aa6", fontSize: 11, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { vertLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" }, horzLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" } },
      localization: { priceFormatter: inr },
    });
    chartRef.current = chart;
    const t = (x: number) => x as UTCTimestamp;

    const value = chart.addSeries(AreaSeries, {
      lineColor: up ? "#22c55e" : "#f43f5e",
      topColor: up ? "rgba(34,197,94,0.28)" : "rgba(244,63,94,0.28)",
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
      priceLineVisible: false,
    });
    value.setData(points.map((p) => ({ time: t(p.t), value: p.value })));

    const invested = chart.addSeries(LineSeries, { color: "#e2e2ee", lineWidth: 1, lineType: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    invested.setData(points.map((p) => ({ time: t(p.t), value: p.invested })));

    const bench = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    bench.setData(points.map((p) => ({ time: t(p.t), value: p.bench })));

    const byT = new Map(points.map((p) => [p.t, p]));
    chart.subscribeCrosshairMove((p) => setHover(p.time ? byT.get(p.time as number) ?? null : null));
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c || !points.length) return;
    const days = RANGES.find((r) => r[0] === range)![1];
    if (!days) return c.timeScale().fitContent();
    const to = points[points.length - 1].t;
    c.timeScale().setVisibleRange({ from: Math.max(points[0].t, to - days * 86400) as UTCTimestamp, to: to as UTCTimestamp });
  }, [range, points]);

  if (points.length < 2) return <div className="muted small" style={{ padding: 24 }}>Not enough price history yet to draw your portfolio.</div>;

  const gain = shown.value - shown.invested;
  const vsBench = shown.value - shown.bench;
  return (
    <div className="chartbox">
      <div className="chart-head">
        <div className="ohlc small">
          <span className="muted">{new Date(shown.t * 1000).toISOString().slice(0, 10)}</span>
          <span>Value <b>{inr(shown.value)}</b></span>
          <span>Invested <b>{inr(shown.invested)}</b></span>
          <span className={gain >= 0 ? "up" : "down"}>{gain >= 0 ? "+" : "−"}{inr(Math.abs(gain))}</span>
          <span className={vsBench >= 0 ? "up" : "down"}>{vsBench >= 0 ? "ahead of" : "behind"} index by {inr(Math.abs(vsBench))}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="legend"><i style={{ background: "#22c55e" }} />Your value</span>
          <span className="legend"><i style={{ background: "#e2e2ee" }} />Invested</span>
          <span className="legend"><i style={{ background: "#22d3ee" }} />Same money in index</span>
          <div className="seg small">
            {RANGES.map(([k]) => (
              <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
            ))}
          </div>
        </div>
      </div>
      <div ref={el} style={{ height, width: "100%" }} />
    </div>
  );
}
