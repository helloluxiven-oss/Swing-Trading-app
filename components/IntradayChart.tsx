"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";

type Bar = { t: number; o: number; h: number; l: number; c: number };
export type Line = { price: number; color: string; title: string; style?: 0 | 1 | 2 | 3 };
export type Mark = { t: number; above: boolean; color: string; text: string };

const RANGES = [
  ["Today", 1],
  ["2D", 2],
  ["5D", 5],
] as const;

/**
 * 5-minute candles with session shading (Asia / London / New York), key levels
 * and sweep markers. Times are shown in New York time, like the session boxes.
 */
export default function IntradayChart({
  bars,
  bands,
  lines,
  marks,
  offsets,
  height = 460,
}: {
  bars: Bar[];
  bands: (string | null)[]; // background colour per bar (session), null = none
  lines: Line[];
  marks: Mark[];
  offsets: number[]; // seconds to add to each bar's time to show New York local time
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("2D");

  useEffect(() => {
    if (!el.current || !bars.length) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8aa6", fontSize: 11, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#22223a" },
      timeScale: { borderColor: "#22223a", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" }, horzLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" } },
    });
    chartRef.current = chart;
    const T = (i: number) => (bars[i].t + offsets[i]) as UTCTimestamp;

    // Session shading: a full-height histogram on its own hidden scale.
    const band = chart.addSeries(HistogramSeries, { priceScaleId: "bands", lastValueVisible: false, priceLineVisible: false, base: 0 });
    chart.priceScale("bands").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
    band.setData(bars.map((_, i) => ({ time: T(i), value: 1, color: bands[i] ?? "rgba(0,0,0,0)" })));

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#f43f5e", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#f43f5e",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candles.setData(bars.map((b, i) => ({ time: T(i), open: b.o, high: b.h, low: b.l, close: b.c })));
    for (const l of lines) candles.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.style ?? 2, title: l.title, axisLabelVisible: true });

    const idx = new Map(bars.map((b, i) => [b.t, i]));
    const ms: SeriesMarker<UTCTimestamp>[] = marks
      .filter((m) => idx.has(m.t))
      .map((m) => ({ time: T(idx.get(m.t)!), position: m.above ? "aboveBar" : "belowBar", color: m.color, shape: m.above ? "arrowDown" : "arrowUp", text: m.text }));
    createSeriesMarkers(candles, ms);

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, bands, lines, marks, offsets]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c || !bars.length) return;
    const n = RANGES.find((r) => r[0] === range)![1] * 288; // 288 five-minute bars a day
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - n), to: bars.length + 6 });
  }, [range, bars.length]);

  return (
    <div className="chartbox">
      <div className="chart-head">
        <div className="row small" style={{ gap: 10 }}>
          <span className="legend"><i style={{ background: "#60a5fa" }} />Asia 20–03</span>
          <span className="legend"><i style={{ background: "#22c55e" }} />London 03–07</span>
          <span className="legend"><i style={{ background: "#f472b6" }} />New York 08–12</span>
          <span className="muted">· New York time · 5m</span>
        </div>
        <div className="seg small">
          {RANGES.map(([k]) => (
            <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
          ))}
        </div>
      </div>
      <div ref={el} style={{ height, width: "100%" }} />
    </div>
  );
}
