"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createTextWatermark,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { gestureMode, zoomChart } from "./chart/zoom";
import { Annotations, useChartTheme } from "./chart/annotations";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

const RANGES: [string, number][] = [
  ["1M", 22],
  ["3M", 65],
  ["6M", 130],
  ["1Y", 260],
];

function offsetFor(timeZone: string | undefined, t: number) {
  if (!timeZone) return 0;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t * 1000))
      .map((x) => [x.type, x.value]),
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t * 1000) / 1000;
}

/**
 * Stock chart, TradingView-style: candles, 20/50 EMA, volume, OHLC legend,
 * the trade plan as a risk/reward zone, your average cost, timeframes,
 * background themes and full screen.
 */
export default function Chart({
  bars,
  ema20,
  ema50,
  levels,
  avgCost,
  height = 420,
  defaultRange = "6M",
  currency = "",
  tf,
  ranges,
  timeZone,
  symbol = "",
}: {
  bars: Bar[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  levels?: { entry: number; stop: number; target: number } | null;
  avgCost?: number | null;
  height?: number;
  defaultRange?: string;
  currency?: string;
  /** Timeframe switcher: current timeframe and the page it links to (`?tf=`). */
  tf?: { current: string; options: string[]; href: string };
  /** Range buttons as [label, bars]; defaults to 1M/3M/6M/1Y of daily bars. */
  ranges?: [string, number][];
  /** Show intraday times in this timezone (the exchange's). */
  timeZone?: string;
  symbol?: string;
}) {
  const rangeSet = ranges ?? RANGES;
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [THEME, cycleTheme] = useChartTheme();
  const [range, setRange] = useState<string>(rangeSet.some((r) => r[0] === defaultRange) ? defaultRange : rangeSet[rangeSet.length - 1][0]);
  const [hoverI, setHoverI] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const i = hoverI ?? bars.length - 1;
  const shown = bars[i];
  const prev = bars[i - 1];

  useEffect(() => {
    if (!el.current || !bars.length) return;
    const chart = createChart(el.current, {
      localization: { locale: "en-US" },
      autoSize: true,
      // Phones: a vertical swipe scrolls the page; drag sideways / pinch to move and zoom the chart.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { touch: true, mouse: false },
      layout: { background: { type: ColorType.Solid, color: THEME.bg }, textColor: THEME.text, fontSize: 11, fontFamily: "Inter, system-ui, sans-serif", attributionLogo: false },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: THEME.border, scaleMargins: { top: 0.08, bottom: 0.16 } },
      timeScale: { borderColor: THEME.border, timeVisible: !!timeZone, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: THEME.cross, style: LineStyle.Dashed, labelBackgroundColor: THEME.crossLabel },
        horzLine: { color: THEME.cross, style: LineStyle.Dashed, labelBackgroundColor: THEME.crossLabel },
      },
    });
    chartRef.current = chart;
    // lightweight-charts shows UTC; shift intraday bars so the axis reads exchange time.
    const time = (t: number) => (t + offsetFor(timeZone, t)) as UTCTimestamp;

    if (symbol) {
      createTextWatermark(chart.panes()[0], {
        horzAlign: "center",
        vertAlign: "center",
        lines: [{ text: `${symbol} · ${(tf?.current ?? "1d").toUpperCase()}`, color: THEME.watermark, fontSize: 44, fontStyle: "bold" }],
      });
    }

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up, downColor: THEME.down, borderVisible: false, wickUpColor: THEME.up, wickDownColor: THEME.down, priceLineColor: "#b39dfb",
    });
    candles.setData(bars.map((b) => ({ time: time(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const line = (vals: (number | null)[], color: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(bars.flatMap((b, k) => (vals[k] == null ? [] : [{ time: time(b.t), value: vals[k] as number }])));
    };
    line(ema20, "#b39dfb");
    line(ema50, "#2196f3");

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: time(b.t), value: b.v, color: b.c >= b.o ? THEME.upVol : THEME.downVol })));

    // Plan as a risk/reward zone starting at the signal bar; average cost as a labelled ray.
    const lastT = time(bars[bars.length - 1].t) as number;
    const zoneFrom = time(bars[Math.max(0, bars.length - 6)].t) as number;
    candles.attachPrimitive(
      new Annotations({
        boxes: [],
        rays: avgCost ? [{ from: time(bars[0].t) as number, to: null, price: avgCost, color: "#fbbf24", label: "Your avg" }] : [],
        zones: levels ? [{ from: zoneFrom, entry: levels.entry, stop: levels.stop, target: levels.target, side: levels.target > levels.entry ? "long" : "short" }] : [],
      }),
    );
    void lastT;

    const byTime = new Map(bars.map((b, k) => [time(b.t) as number, k]));
    chart.subscribeCrosshairMove((p) => setHoverI(p.time !== undefined ? byTime.get(p.time as number) ?? null : null));

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, ema20, ema50, levels, avgCost, timeZone, THEME, symbol, tf?.current]);

  useEffect(() => {
    const n = rangeSet.find((r) => r[0] === range)?.[1] ?? rangeSet[0][1];
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - n), to: bars.length + 6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, bars.length, THEME]);

  const toggleFull = async () => {
    const node = wrap.current;
    if (!node) return;
    if (!full && node.requestFullscreen) {
      try {
        await node.requestFullscreen();
      } catch {}
    } else if (document.fullscreenElement) await document.exitFullscreen();
    setFull(!full);
  };
  useEffect(() => {
    gestureMode(chartRef.current, full);
  }, [full, THEME]);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const f = (x: number) => `${currency}${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const chg = shown && prev ? shown.c - prev.c : 0;
  const dir = shown && shown.c >= shown.o ? "up" : "down";
  const when = shown
    ? timeZone
      ? new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(shown.t * 1000))
      : new Date(shown.t * 1000).toISOString().slice(0, 10)
    : "";

  return (
    <div ref={wrap} className={`tv ${full ? "tv-full" : ""}`} data-theme={THEME.name} style={{ background: THEME.bg }}>
      <div className="tv-bar">
        <div className="tv-tfs" role="tablist" aria-label="Timeframe">
          {tf?.options.map((k) => (
            <Link key={k} href={`${tf.href}?tf=${k}`} scroll={false} className={tf.current === k ? "on" : ""} role="tab" aria-selected={tf.current === k}>{k.replace("h", "H").replace("d", "D")}</Link>
          ))}
        </div>
        <div className="tv-tfs">
          {rangeSet.map(([k]) => (
            <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
          ))}
          <button onClick={() => zoomChart(chartRef.current, 0.7, bars.length)} aria-label="Zoom in" title="Zoom in">＋</button>
          <button onClick={() => zoomChart(chartRef.current, 1.45, bars.length)} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={() => chartRef.current?.timeScale().fitContent()} aria-label="Show everything" title="Fit all">⤢</button>
          <button onClick={cycleTheme} title="Chart background" aria-label={`Background: ${THEME.label}. Change`}>◐ {THEME.label}</button>
          <button onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} title="Full screen">{full ? "✕" : "⛶"}</button>
        </div>
      </div>
      <div className="tv-stage" style={{ ["--h" as string]: `${height}px`, height: full ? undefined : "var(--h)" }}>
        {shown && (
          <div className="tv-legend">
            {symbol && <b>{symbol}</b>}
            <span className="muted">{when}</span>
            <span>O <i className={dir}>{f(shown.o)}</i></span>
            <span>H <i className={dir}>{f(shown.h)}</i></span>
            <span>L <i className={dir}>{f(shown.l)}</i></span>
            <span>C <i className={dir}>{f(shown.c)}</i></span>
            {prev && <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{((chg / prev.c) * 100).toFixed(2)}%</span>}
          </div>
        )}
        <div ref={el} className="tv-canvas" />
      </div>
      <div className="tv-key">
        <span><i style={{ background: "#b39dfb" }} />20 EMA</span>
        <span><i style={{ background: "#2196f3" }} />50 EMA</span>
        {avgCost ? <span><i style={{ background: "#fbbf24" }} />Your average</span> : null}
        {levels ? <span><i style={{ background: "#26a69a" }} />Plan: entry · stop · target</span> : null}
      </div>
    </div>
  );
}
