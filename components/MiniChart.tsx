"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { useChartTheme } from "./chart/annotations";

type Bar = { t: number; o: number; h: number; l: number; c: number };

/**
 * A small, read-only candle chart for the dashboard. It ignores touches and
 * clicks on purpose, so tapping it opens the full chart instead.
 */
export default function MiniChart({ bars, precision = 2, height = 170 }: { bars: Bar[]; precision?: number; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [T] = useChartTheme();
  useEffect(() => {
    if (!el.current || bars.length < 2) return;
    const chart = createChart(el.current, {
      autoSize: true,
      localization: { locale: "en-US" },
      layout: { background: { type: ColorType.Solid, color: T.bg }, textColor: T.text, fontSize: 10, fontFamily: "Inter, system-ui, sans-serif", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: T.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderVisible: false, visible: false, rightOffset: 3 },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });
    const s = chart.addSeries(CandlestickSeries, {
      upColor: T.up, downColor: T.down, borderVisible: false, wickUpColor: T.up, wickDownColor: T.down,
      priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
      priceLineColor: "#b39dfb",
    });
    s.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, precision, T]);
  return <div ref={el} className="mini-chart" style={{ height, background: T.bg }} aria-hidden="true" />;
}
