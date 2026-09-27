"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { gestureMode, zoomChart } from "./chart/zoom";
import { Annotations, useChartTheme, type Drawings } from "./chart/annotations";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Mark = { t: number; above: boolean; color: string; text: string };

const TFS = ["1m", "5m", "15m", "1h", "4h"] as const;
type Tf = (typeof TFS)[number];

const RANGES: Record<Tf, [string, number][]> = {
  "1m": [["1H", 3600], ["4H", 14400], ["Day", 86400]],
  "5m": [["Today", 86400], ["2D", 172800], ["5D", 432000]],
  "15m": [["2D", 172800], ["1W", 604800], ["1M", 2592000]],
  "1h": [["1W", 604800], ["1M", 2592000], ["3M", 7776000]],
  "4h": [["1M", 2592000], ["3M", 7776000], ["6M", 15552000]],
};

/** Index of the bar containing time t. */
function snap(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}



/**
 * Gold chart, TradingView-style: session boxes, labelled liquidity levels,
 * a risk/reward zone for the live plan, sweep markers, volume, OHLC legend.
 * Times in New York.
 */
export default function IntradayChart({
  bars,
  drawings,
  marks,
  offsets,
  tf,
  symbol = "XAUUSD",
  height = 520,
  precision = 2,
  hrefBase = "/fx?s=XAUUSD&tf=",
  sessions = true,
}: {
  bars: Bar[];
  drawings: Drawings;
  marks: Mark[];
  offsets: number[];
  tf: Tf;
  symbol?: string;
  height?: number;
  precision?: number;
  /** Timeframe links: hrefBase + tf. */
  hrefBase?: string;
  /** Show the session legend (strategy instruments only). */
  sessions?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [THEME, cycleTheme] = useChartTheme();
  const ranges = RANGES[tf];
  const [range, setRange] = useState(ranges[tf === "5m" ? 1 : 0][0]);
  // Phones: start on the shortest window so candles stay readable.
  useEffect(() => {
    if (window.innerWidth < 700) setRange(ranges[0][0]);
  }, [ranges]);
  const [hover, setHover] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const fx = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
  const idx = hover ?? bars.length - 1;
  const b = bars[idx];
  const prev = bars[idx - 1];

  // Move every drawing onto this timeframe's bars (and New York time).
  const local = useMemo(() => {
    const T = (t: number) => {
      const i = snap(bars, t);
      return i < 0 ? null : bars[i].t + offsets[i];
    };
    const ok = <X,>(x: X | null): x is X => x !== null;
    const boxes = tf === "1h" || tf === "4h" ? [] : drawings.boxes.map((x) => { const f = T(x.from), t = T(x.to); return f === null || t === null ? null : { ...x, from: f, to: t }; }).filter(ok);
    const rays = drawings.rays.map((r) => { const f = T(r.from); return f === null ? null : { ...r, from: f, to: r.to === null ? null : T(r.to) }; }).filter(ok);
    const zones = drawings.zones.map((z) => { const f = T(z.from); return f === null ? null : { ...z, from: f }; }).filter(ok);
    return { boxes, rays, zones };
  }, [bars, offsets, drawings, tf]);

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
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: el.current.clientWidth < 600 ? 10 : 20, barSpacing: 7 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: THEME.cross, style: LineStyle.Dashed, labelBackgroundColor: THEME.crossLabel },
        horzLine: { color: THEME.cross, style: LineStyle.Dashed, labelBackgroundColor: THEME.crossLabel },
      },
    });
    chartRef.current = chart;
    const T = (i: number) => (bars[i].t + offsets[i]) as UTCTimestamp;

    createTextWatermark(chart.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [{ text: `${symbol} · ${tf.toUpperCase()}`, color: THEME.watermark, fontSize: 44, fontStyle: "bold" }],
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up, downColor: THEME.down, borderVisible: false, wickUpColor: THEME.up, wickDownColor: THEME.down,
      priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
      priceLineColor: "#b39dfb",
    });
    candles.setData(bars.map((x, i) => ({ time: T(i), open: x.o, high: x.h, low: x.l, close: x.c })));

    if (bars.some((x) => x.v > 0)) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.89, bottom: 0 } });
      vol.setData(bars.map((x, i) => ({ time: T(i), value: x.v, color: x.c >= x.o ? THEME.upVol : THEME.downVol })));
    }

    const ann = new Annotations(local);
    candles.attachPrimitive(ann);

    const ms: SeriesMarker<UTCTimestamp>[] = [];
    const seen = new Set<string>();
    for (const m of marks) {
      const i = snap(bars, m.t);
      if (i < 0 || seen.has(`${i}${m.above}`)) continue;
      seen.add(`${i}${m.above}`);
      ms.push({ time: T(i), position: m.above ? "aboveBar" : "belowBar", color: m.color, shape: m.above ? "arrowDown" : "arrowUp", text: m.text, size: 1.2 });
    }
    ms.sort((x, y) => (x.time as number) - (y.time as number));
    createSeriesMarkers(candles, ms);

    const byTime = new Map(bars.map((_, i) => [T(i) as number, i]));
    chart.subscribeCrosshairMove((p) => setHover(p.time !== undefined ? byTime.get(p.time as number) ?? null : null));

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, offsets, local, marks, tf, symbol, THEME, precision]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c || !bars.length) return;
    const secs = ranges.find((r) => r[0] === range)?.[1] ?? ranges[0][1];
    const from = snap(bars, bars[bars.length - 1].t - secs);
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, from), to: bars.length + 20 });
  }, [range, bars, ranges, THEME]);

  // Full screen: the real API where it exists, a fixed overlay on iPhone.
  const toggleFull = async () => {
    const node = wrap.current;
    if (!node) return;
    if (!full && node.requestFullscreen) {
      try {
        await node.requestFullscreen();
        (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
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

  const chg = b && prev ? b.c - prev.c : 0;
  return (
    <div ref={wrap} className={`tv ${full ? "tv-full" : ""}`} data-theme={THEME.name} style={{ background: THEME.bg }}>
      <div className="tv-bar">
        <div className="tv-tfs" role="tablist" aria-label="Timeframe">
          {TFS.map((k) => (
            <Link key={k} href={`${hrefBase}${k}`} scroll={false} className={tf === k ? "on" : ""} role="tab" aria-selected={tf === k}>{k.replace("m", "m").replace("h", "H")}</Link>
          ))}
        </div>
        <div className="tv-tfs">
          {ranges.map(([k]) => (
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
        {b && (
          <div className="tv-legend">
            <b>{symbol}</b>
            <span className="muted">{tf.toUpperCase()}</span>
            <span>O <i className={b.c >= b.o ? "up" : "down"}>{fx(b.o)}</i></span>
            <span>H <i className={b.c >= b.o ? "up" : "down"}>{fx(b.h)}</i></span>
            <span>L <i className={b.c >= b.o ? "up" : "down"}>{fx(b.l)}</i></span>
            <span>C <i className={b.c >= b.o ? "up" : "down"}>{fx(b.c)}</i></span>
            {prev && <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{fx(chg)} ({((chg / prev.c) * 100).toFixed(2)}%)</span>}
          </div>
        )}
        <div ref={el} className="tv-canvas" />
      </div>
      {sessions ? (
        <div className="tv-key">
          <span><i style={{ background: "#60a5fa" }} />Asia</span>
          <span><i style={{ background: "#22c55e" }} />London</span>
          <span><i style={{ background: "#f472b6" }} />New York</span>
          <span><i style={{ background: "#fbbf24" }} />Prev day</span>
          <span className="muted">boxes = session high→low · H✕ / L✕ = that side swept · New York time</span>
        </div>
      ) : (
        <div className="tv-key">
          <span><i style={{ background: "#fbbf24" }} />Previous day high / low</span>
          <span className="muted">New York time</span>
        </div>
      )}
    </div>
  );
}
