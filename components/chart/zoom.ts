import type { IChartApi } from "lightweight-charts";

/** Zoom the time axis around the latest bar. factor > 1 zooms out, < 1 zooms in. */
export function zoomChart(chart: IChartApi | null, factor: number, total: number) {
  const ts = chart?.timeScale();
  const r = ts?.getVisibleLogicalRange();
  if (!ts || !r) return;
  const right = r.to;
  const width = Math.min(Math.max((r.to - r.from) * factor, 12), total + 40);
  ts.setVisibleLogicalRange({ from: right - width, to: right });
}

/** Full screen hands every gesture to the chart; inline, vertical swipes scroll the page. */
export function gestureMode(chart: IChartApi | null, full: boolean) {
  chart?.applyOptions({
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: full },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
}
