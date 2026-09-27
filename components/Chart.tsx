"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export default function Chart({
  bars,
  ema20,
  ema50,
  levels,
}: {
  bars: Bar[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  levels?: { entry: number; stop: number; target: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#11111c" }, textColor: "#a6a6c0", fontSize: 11 },
      grid: { vertLines: { color: "#1a1a2c" }, horzLines: { color: "#1a1a2c" } },
      rightPriceScale: { borderColor: "#22223a" },
      timeScale: { borderColor: "#22223a" },
      crosshair: { mode: 0 },
    });
    const time = (t: number) => t as UTCTimestamp;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#f43f5e",
    });
    candles.setData(bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const line = (vals: (number | null)[], color: string, title: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title });
      s.setData(bars.flatMap((b, i) => (vals[i] == null ? [] : [{ time: time(b.t), value: vals[i] as number }])));
    };
    line(ema20, "#b39dfb", "20 EMA");
    line(ema50, "#22d3ee", "50 EMA");

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: time(b.t), value: b.v, color: b.c >= b.o ? "rgba(34,197,94,.35)" : "rgba(244,63,94,.35)" })));

    if (levels) {
      candles.createPriceLine({ price: levels.entry, color: "#e2e2ee", lineWidth: 1, lineStyle: 2, title: "Entry" });
      candles.createPriceLine({ price: levels.stop, color: "#f43f5e", lineWidth: 1, lineStyle: 2, title: "Stop" });
      candles.createPriceLine({ price: levels.target, color: "#22c55e", lineWidth: 1, lineStyle: 2, title: "Target" });
    }

    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 120), to: bars.length + 3 });
    return () => chart.remove();
  }, [bars, ema20, ema50, levels]);

  return <div ref={el} className="chart" />;
}
