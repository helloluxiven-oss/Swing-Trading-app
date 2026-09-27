"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

const RANGES = [
  ["1M", 22],
  ["3M", 65],
  ["6M", 130],
  ["1Y", 260],
] as const;

/**
 * Candles + 20/50 EMA + volume, with range buttons and a crosshair readout.
 * `levels` draws entry / stop / target (or an avg-cost line for a holding).
 */
export default function Chart({
  bars,
  ema20,
  ema50,
  levels,
  avgCost,
  height = 380,
  defaultRange = "6M",
  currency = "",
}: {
  bars: Bar[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  levels?: { entry: number; stop: number; target: number } | null;
  avgCost?: number | null;
  height?: number;
  defaultRange?: (typeof RANGES)[number][0];
  currency?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>(defaultRange);
  const last = bars[bars.length - 1];
  const [hover, setHover] = useState<Bar | null>(null);
  const shown = hover ?? last;

  useEffect(() => {
    if (!el.current || !bars.length) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8aa6", fontSize: 11, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#22223a" },
      timeScale: { borderColor: "#22223a" },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" }, horzLine: { color: "#b39dfb55", labelBackgroundColor: "#352f5e" } },
      handleScale: { axisPressedMouseMove: true },
    });
    chartRef.current = chart;
    const time = (t: number) => t as UTCTimestamp;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#f43f5e", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#f43f5e",
    });
    candles.setData(bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const line = (vals: (number | null)[], color: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(bars.flatMap((b, i) => (vals[i] == null ? [] : [{ time: time(b.t), value: vals[i] as number }])));
    };
    line(ema20, "#b39dfb");
    line(ema50, "#22d3ee");

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: time(b.t), value: b.v, color: b.c >= b.o ? "rgba(34,197,94,.28)" : "rgba(244,63,94,.28)" })));

    if (levels) {
      candles.createPriceLine({ price: levels.entry, color: "#e2e2ee", lineWidth: 1, lineStyle: 2, title: "Entry" });
      candles.createPriceLine({ price: levels.stop, color: "#f43f5e", lineWidth: 1, lineStyle: 2, title: "Stop" });
      candles.createPriceLine({ price: levels.target, color: "#22c55e", lineWidth: 1, lineStyle: 2, title: "Target" });
    }
    if (avgCost) candles.createPriceLine({ price: avgCost, color: "#fbbf24", lineWidth: 1, lineStyle: 1, title: "Your avg" });

    const byTime = new Map(bars.map((b) => [b.t, b]));
    chart.subscribeCrosshairMove((p) => setHover(p.time ? byTime.get(p.time as number) ?? null : null));

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, ema20, ema50, levels, avgCost]);

  useEffect(() => {
    const n = RANGES.find((r) => r[0] === range)![1];
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - n), to: bars.length + 2 });
  }, [range, bars.length]);

  const chg = shown ? ((shown.c - shown.o) / shown.o) * 100 : 0;
  const f = (x: number) => `${currency}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="chartbox">
      <div className="chart-head">
        {shown && (
          <div className="ohlc small">
            <span className="muted">{new Date(shown.t * 1000).toISOString().slice(0, 10)}</span>
            <span>O <b>{f(shown.o)}</b></span>
            <span>H <b>{f(shown.h)}</b></span>
            <span>L <b>{f(shown.l)}</b></span>
            <span>C <b>{f(shown.c)}</b></span>
            <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <span className="legend"><i style={{ background: "#b39dfb" }} />20 EMA</span>
          <span className="legend"><i style={{ background: "#22d3ee" }} />50 EMA</span>
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
