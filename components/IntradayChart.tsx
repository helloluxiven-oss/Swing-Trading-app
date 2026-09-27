"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";

type Bar = { t: number; o: number; h: number; l: number; c: number };
export type Line = { price: number; color: string; title: string; style?: 0 | 1 | 2 | 3 };
/** A horizontal level drawn from where it was made to where it was swept (or to now). */
export type Level = { fromT: number; toT: number; price: number; color: string; title: string; dashed: boolean };
export type Mark = { t: number; above: boolean; color: string; text: string };

const TFS = ["1m", "5m", "15m", "1h", "4h"] as const;
type Tf = (typeof TFS)[number];

/** Visible window per timeframe: label → seconds. */
const RANGES: Record<Tf, [string, number][]> = {
  "1m": [["1H", 3600], ["4H", 14400], ["Day", 86400]],
  "5m": [["Today", 86400], ["2D", 172800], ["5D", 432000]],
  "15m": [["2D", 172800], ["1W", 604800], ["1M", 2592000]],
  "1h": [["1W", 604800], ["1M", 2592000], ["3M", 7776000]],
  "4h": [["1M", 2592000], ["3M", 7776000], ["6M", 15552000]],
};

/** Index of the bar containing time t (last bar that opened at or before t). */
function snap(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Candles with session shading (Asia / London / New York), session highs and
 * lows, key levels and sweep markers. New York time on the axis.
 */
export default function IntradayChart({
  bars,
  bands,
  lines,
  marks,
  levels = [],
  offsets,
  tf,
  height = 480,
}: {
  bars: Bar[];
  bands: (string | null)[];
  lines: Line[];
  marks: Mark[];
  levels?: Level[];
  offsets: number[];
  tf: Tf;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const ranges = RANGES[tf];
  const [range, setRange] = useState(ranges[tf === "5m" ? 1 : 0][0]);

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

    // Session shading only makes sense up to the 15-minute chart.
    if (tf === "1m" || tf === "5m" || tf === "15m") {
      const band = chart.addSeries(HistogramSeries, { priceScaleId: "bands", lastValueVisible: false, priceLineVisible: false, base: 0 });
      chart.priceScale("bands").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
      band.setData(bars.map((_, i) => ({ time: T(i), value: 1, color: bands[i] ?? "rgba(0,0,0,0)" })));
    }

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#f43f5e", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#f43f5e",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candles.setData(bars.map((b, i) => ({ time: T(i), open: b.o, high: b.h, low: b.l, close: b.c })));
    for (const l of lines) candles.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.style ?? 2, title: l.title, axisLabelVisible: true });

    for (const lv of levels) {
      const a = snap(bars, lv.fromT), b = snap(bars, lv.toT);
      if (a < 0 || b < 0) continue;
      const end = b > a ? b : Math.min(a + 1, bars.length - 1);
      if (end <= a) continue;
      const s = chart.addSeries(LineSeries, {
        color: lv.color, lineWidth: 1, lineStyle: lv.dashed ? 2 : 0, priceLineVisible: false, crosshairMarkerVisible: false,
        lastValueVisible: !lv.dashed, title: lv.dashed ? "" : lv.title,
      });
      s.setData([{ time: T(a), value: lv.price }, { time: T(end), value: lv.price }]);
    }

    const ms: SeriesMarker<UTCTimestamp>[] = [];
    const seen = new Set<string>();
    for (const m of marks) {
      const i = snap(bars, m.t);
      if (i < 0) continue;
      const k = `${i}${m.above}`;
      if (seen.has(k)) continue; // one marker per bar and side on higher timeframes
      seen.add(k);
      ms.push({ time: T(i), position: m.above ? "aboveBar" : "belowBar", color: m.color, shape: m.above ? "arrowDown" : "arrowUp", text: m.text });
    }
    ms.sort((x, y) => (x.time as number) - (y.time as number));
    createSeriesMarkers(candles, ms);

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, bands, lines, marks, levels, offsets, tf]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c || !bars.length) return;
    const secs = ranges.find((r) => r[0] === range)?.[1] ?? ranges[0][1];
    const from = snap(bars, bars[bars.length - 1].t - secs);
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, from), to: bars.length + 4 });
  }, [range, bars, ranges]);

  return (
    <div className="chartbox">
      <div className="chart-head">
        <div className="seg small" role="tablist" aria-label="Timeframe">
          {TFS.map((k) => (
            <Link key={k} href={`/gold?tf=${k}`} scroll={false} className={tf === k ? "on" : ""} aria-selected={tf === k} role="tab">
              {k.toUpperCase()}
            </Link>
          ))}
        </div>
        <div className="row small" style={{ gap: 10 }}>
          <span className="legend"><i style={{ background: "#60a5fa" }} />Asia</span>
          <span className="legend"><i style={{ background: "#22c55e" }} />London</span>
          <span className="legend"><i style={{ background: "#f472b6" }} />New York</span>
          <span className="legend"><i style={{ background: "#e2e2ee" }} />solid = resting · dashed = swept</span>
          <div className="seg small">
            {ranges.map(([k]) => (
              <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
            ))}
          </div>
        </div>
      </div>
      <div ref={el} style={{ height, width: "100%" }} />
    </div>
  );
}
