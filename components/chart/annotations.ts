// Canvas drawings on top of a lightweight-charts series, TradingView-style:
// session boxes (high→low rectangles with a label), horizontal levels that
// start where they were made with a pill label at the end, and a
// position zone (red risk / green reward) for an entry, stop and target.

import { useEffect, useState } from "react";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

export type Box = { from: number; to: number; top: number; bottom: number; color: string; label: string; live?: boolean };
export type Ray = { from: number; to: number | null; price: number; color: string; label: string; dashed?: boolean };
export type Zone = { from: number; entry: number; stop: number; target: number; side: "long" | "short" };
export type Drawings = { boxes: Box[]; rays: Ray[]; zones: Zone[]; precision?: number };

const FONT = "600 10px Inter, system-ui, sans-serif";
/** Width reserved on the right for level labels; charts set a matching rightOffset. */
export const LABEL_COL = 118;

function alpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg = "#0b0b12", alignRight = true) {
  ctx.font = FONT;
  const w = ctx.measureText(text).width + 10;
  const h = 15;
  const left = alignRight ? x - w : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 5, y + 0.5);
}

class Renderer implements IPrimitivePaneRenderer {
  constructor(private src: Annotations) {}
  draw() {}
  drawBackground(target: CanvasRenderingTarget2D) {
    const { chart, series } = this.src;
    if (!chart || !series) return;
    const d = this.src.data;
    const pr = d.precision ?? 2;
    const ts = chart.timeScale();
    const x = (t: number) => ts.timeToCoordinate(t as UTCTimestamp);
    const y = (p: number) => series.priceToCoordinate(p);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const right = mediaSize.width;
      const compact = mediaSize.width < 600;

      // Session boxes
      for (const b of d.boxes) {
        const x1 = x(b.from), y1 = y(b.top), y2 = y(b.bottom);
        const x2: number | null = b.live ? (x(b.to) as number | null) ?? right : x(b.to);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        ctx.fillStyle = alpha(b.color, 0.09);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeStyle = alpha(b.color, 0.55);
        ctx.lineWidth = 1;
        ctx.setLineDash(b.live ? [4, 3] : []);
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1);
        ctx.setLineDash([]);
        ctx.font = FONT;
        ctx.fillStyle = alpha(b.color, 0.95);
        ctx.textBaseline = "bottom";
        if (!compact || x2 - x1 > 70) ctx.fillText(compact ? b.label.split(" · ").filter((x) => !/^[\d.,]+$/.test(x)).join(" · ") : b.label, x1 + 4, y1 - 3);
      }

      // Risk / reward zones
      for (const z of d.zones) {
        const x1 = x(z.from), ye = y(z.entry), ys = y(z.stop), yt = y(z.target);
        if (x1 === null || ye === null || ys === null || yt === null) continue;
        // Leave the right-hand label column (level pills) clear.
        const x2 = Math.max(x1 + 24, right - (compact ? 64 : LABEL_COL));
        const w = x2 - x1;
        ctx.fillStyle = "rgba(239,83,80,0.16)";
        ctx.fillRect(x1, Math.min(ye, ys), w, Math.abs(ys - ye));
        ctx.fillStyle = "rgba(38,166,154,0.16)";
        ctx.fillRect(x1, Math.min(ye, yt), w, Math.abs(yt - ye));
        ctx.strokeStyle = "rgba(226,226,238,0.8)";
        ctx.beginPath();
        ctx.moveTo(x1, ye + 0.5);
        ctx.lineTo(x2, ye + 0.5);
        ctx.stroke();
        const rr = Math.abs(z.target - z.entry) / Math.abs(z.entry - z.stop);
        // Labels sit inside the zone when there is room, otherwise just left of it.
        const inside = w > (compact ? 110 : 150);
        const lx = inside ? x1 + 4 : x1 - 4;
        pill(ctx, lx, ye, compact ? (z.side === "long" ? "LONG" : "SHORT") : `${z.side === "long" ? "LONG" : "SHORT"} ${z.entry.toFixed(pr)}`, "#e2e2ee", "#0b0b12", !inside);
        pill(ctx, lx, yt + (yt < ye ? 9 : -9), compact ? `TP ${rr.toFixed(1)}R` : `TP ${z.target.toFixed(pr)} · ${rr.toFixed(1)}R`, "#26a69a", "#fff", !inside);
        pill(ctx, lx, ys + (ys < ye ? 9 : -9), compact ? "SL" : `SL ${z.stop.toFixed(pr)}`, "#ef5350", "#fff", !inside);
      }
    });
  }
}

class TopRenderer implements IPrimitivePaneRenderer {
  constructor(private src: Annotations) {}
  draw(target: CanvasRenderingTarget2D) {
    const { chart, series } = this.src;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const right = mediaSize.width - 4;
      const pr = this.src.data.precision ?? 2;
      const compact = mediaSize.width < 600;
      const placed: number[] = [];
      for (const r of this.src.data.rays) {
        const x1 = ts.timeToCoordinate(r.from as UTCTimestamp);
        const yy = series.priceToCoordinate(r.price);
        if (yy === null) continue;
        const x2: number = r.to === null ? right : (ts.timeToCoordinate(r.to as UTCTimestamp) as number | null) ?? right;
        const start = x1 ?? 0;
        ctx.strokeStyle = alpha(r.color, r.dashed ? 0.45 : 0.9);
        ctx.lineWidth = 1;
        ctx.setLineDash(r.dashed ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(start, Math.round(yy) + 0.5);
        ctx.lineTo(x2, Math.round(yy) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (r.dashed) {
          ctx.font = FONT;
          ctx.fillStyle = alpha(r.color, 0.6);
          ctx.textBaseline = "bottom";
          if (!compact) ctx.fillText(`${r.label} ✕`, Math.max(start, x2 - 60), yy - 2);
          continue;
        }
        // keep labels from stacking on top of each other
        let ly: number = yy;
        while (placed.some((p) => Math.abs(p - ly) < 16)) ly += 16;
        placed.push(ly);
        pill(ctx, right, ly, compact ? r.label : `${r.label} ${r.price.toFixed(pr)}`, r.color);
      }
    });
  }
}

class View implements IPrimitivePaneView {
  constructor(private r: IPrimitivePaneRenderer, private z: "bottom" | "top") {}
  zOrder() {
    return this.z;
  }
  renderer() {
    return this.r;
  }
}

export class Annotations implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private views: View[];
  constructor(public data: Drawings) {
    this.views = [new View(new Renderer(this), "bottom"), new View(new TopRenderer(this), "top")];
  }
  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<SeriesType>;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
  }
  paneViews() {
    return this.views;
  }
  set(data: Drawings) {
    this.data = data;
    this.requestUpdate?.();
  }
}

export type ThemeName = "premium" | "tv" | "light" | "black";
export type ChartTheme = {
  name: ThemeName; label: string; bg: string; up: string; down: string; upVol: string; downVol: string;
  text: string; grid: string; border: string; cross: string; crossLabel: string; watermark: string;
};

/** Chart backgrounds. "tv" is TradingView's own dark; "light" matches its light chart. */
export const THEMES: Record<ThemeName, ChartTheme> = {
  // Exchange-grade palette (the pro-terminal look): near-black blue, mint / coral candles.
  premium: { name: "premium", label: "Premium", bg: "#0b0e11", up: "#0ecb81", down: "#f6465d", upVol: "rgba(14,203,129,0.32)", downVol: "rgba(246,70,93,0.32)", text: "#848e9c", grid: "rgba(43,49,57,0.55)", border: "#2b3139", cross: "#5e6673", crossLabel: "#2b3139", watermark: "rgba(234,236,239,0.035)" },
  tv: { name: "tv", label: "Dark", bg: "#131722", up: "#26a69a", down: "#ef5350", upVol: "rgba(38,166,154,0.35)", downVol: "rgba(239,83,80,0.35)", text: "#b2b5be", grid: "rgba(42,46,57,0.6)", border: "#2a2e39", cross: "#758696", crossLabel: "#363a45", watermark: "rgba(255,255,255,0.04)" },
  light: { name: "light", label: "Light", bg: "#ffffff", up: "#089981", down: "#f23645", upVol: "rgba(8,153,129,0.3)", downVol: "rgba(242,54,69,0.3)", text: "#131722", grid: "rgba(42,46,57,0.06)", border: "#e0e3eb", cross: "#9598a1", crossLabel: "#131722", watermark: "rgba(19,23,34,0.05)" },
  black: { name: "black", label: "Black", bg: "#0b0b12", up: "#26a69a", down: "#ef5350", upVol: "rgba(38,166,154,0.35)", downVol: "rgba(239,83,80,0.35)", text: "#9598a1", grid: "rgba(255,255,255,0.045)", border: "rgba(255,255,255,0.08)", cross: "#758696", crossLabel: "#2a2e39", watermark: "rgba(255,255,255,0.035)" },
};
export const THEME = THEMES.premium;
const ORDER: ThemeName[] = ["premium", "tv", "light", "black"];
export const nextTheme = (t: ThemeName): ThemeName => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length];

const KEY = "chart-theme";
export function loadTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY) as ThemeName | null;
    return v && v in THEMES ? v : "premium";
  } catch {
    return "premium";
  }
}
export function saveTheme(t: ThemeName) {
  try {
    localStorage.setItem(KEY, t);
    window.dispatchEvent(new CustomEvent(KEY, { detail: t }));
  } catch {}
}
/** React hook: current chart theme, shared by every chart on the page and remembered on this device. */
export function useChartTheme(): [ChartTheme, () => void] {
  const [name, setName] = useState<ThemeName>("premium");
  useEffect(() => {
    setName(loadTheme());
    const on = (e: Event) => setName((e as CustomEvent<ThemeName>).detail);
    window.addEventListener(KEY, on);
    return () => window.removeEventListener(KEY, on);
  }, []);
  return [THEMES[name], () => saveTheme(nextTheme(name))];
}
