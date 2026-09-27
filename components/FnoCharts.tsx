// Server-rendered SVG charts for the F&O desk (no JavaScript shipped).

import type { ChainRow } from "@/lib/options";
import { payoff, type Leg } from "@/lib/strategies";

const fmtK = (x: number) => (Math.abs(x) >= 1e7 ? `${(x / 1e7).toFixed(1)}Cr` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(1)}L` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(0));

/** Open interest by strike: calls to the right (red, resistance), puts to the left (green, support). */
export function OIChart({ rows, spot, marks }: { rows: ChainRow[]; spot: number; marks: { label: string; strike: number | null; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.callOI, r.putOI)));
  const H = 18, W = 640, mid = W / 2, pad = 70;
  const h = rows.length * H + 10;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="fno-svg" role="img" aria-label="Open interest by strike">
      {rows.map((r, i) => {
        const y = 5 + i * H;
        const cw = ((mid - pad) * r.callOI) / max, pw = ((mid - pad) * r.putOI) / max;
        const atSpot = i < rows.length - 1 && r.strike <= spot && rows[i + 1].strike > spot;
        const mark = marks.find((m) => m.strike === r.strike);
        return (
          <g key={r.strike}>
            <rect x={mid - pw - 30} y={y + 3} width={pw} height={H - 6} rx="2" fill="rgba(14,203,129,0.75)" />
            <rect x={mid + 30} y={y + 3} width={cw} height={H - 6} rx="2" fill="rgba(246,70,93,0.75)" />
            <text x={mid} y={y + H / 2 + 4} textAnchor="middle" className="fno-strike" fill={mark ? mark.color : undefined}>{r.strike}</text>
            {r.putOI > 0 && <text x={mid - pw - 34} y={y + H / 2 + 4} textAnchor="end" className="fno-val">{fmtK(r.putOI)}</text>}
            {r.callOI > 0 && <text x={mid + cw + 34} y={y + H / 2 + 4} className="fno-val">{fmtK(r.callOI)}</text>}
            {mark && <text x={W - 4} y={y + H / 2 + 4} textAnchor="end" className="fno-mark" fill={mark.color}>{mark.label}</text>}
            {atSpot && <line x1="0" x2={W} y1={y + H} y2={y + H} stroke="#b39dfb" strokeDasharray="4 3" />}
          </g>
        );
      })}
      <text x={mid - 40} y={h - 1} textAnchor="end" className="fno-val" fill="#0ecb81">◀ Put OI (support)</text>
      <text x={mid + 40} y={h - 1} className="fno-val" fill="#f6465d">Call OI (resistance) ▶</text>
    </svg>
  );
}

/** Dealer gamma exposure by strike. Green = dampening, red = amplifying. */
export function GexChart({ data, spot }: { data: { strike: number; gex: number }[]; spot: number }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.gex)));
  const W = 640, H = 160, bw = W / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="fno-svg" role="img" aria-label="Dealer gamma by strike">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.15)" />
      {data.map((d, i) => {
        const h = ((H / 2 - 4) * Math.abs(d.gex)) / max;
        return <rect key={d.strike} x={i * bw + 1} y={d.gex >= 0 ? H / 2 - h : H / 2} width={Math.max(1, bw - 2)} height={h} fill={d.gex >= 0 ? "rgba(14,203,129,0.8)" : "rgba(246,70,93,0.8)"} />;
      })}
      {(() => {
        const i = data.findIndex((d) => d.strike >= spot);
        return i >= 0 ? <line x1={i * bw} x2={i * bw} y1="0" y2={H} stroke="#b39dfb" strokeDasharray="4 3" /> : null;
      })()}
      {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0).map((d) => (
        <text key={d.strike} x={data.indexOf(d) * bw + bw / 2} y={H + 14} textAnchor="middle" className="fno-val">{d.strike}</text>
      ))}
    </svg>
  );
}

/** Implied volatility smile: calls and puts by strike. */
export function SmileChart({ rows, spot }: { rows: ChainRow[]; spot: number }) {
  const pts = rows.filter((r) => r.callIV || r.putIV);
  if (pts.length < 3) return null;
  const ivs = pts.flatMap((r) => [r.callIV, r.putIV].filter((x): x is number => !!x));
  const lo = Math.min(...ivs), hi = Math.max(...ivs);
  const W = 640, H = 170, k0 = pts[0].strike, k1 = pts[pts.length - 1].strike;
  const x = (k: number) => ((k - k0) / (k1 - k0 || 1)) * (W - 20) + 10;
  const y = (v: number) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 30);
  const path = (get: (r: ChainRow) => number | null) => pts.filter(get).map((r, i) => `${i ? "L" : "M"}${x(r.strike).toFixed(1)},${y(get(r)!).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="fno-svg" role="img" aria-label="Volatility smile">
      <path d={path((r) => r.putIV)} fill="none" stroke="#0ecb81" strokeWidth="2" />
      <path d={path((r) => r.callIV)} fill="none" stroke="#f6465d" strokeWidth="2" />
      <line x1={x(spot)} x2={x(spot)} y1="0" y2={H} stroke="#b39dfb" strokeDasharray="4 3" />
      <text x="10" y="12" className="fno-val">{(hi * 100).toFixed(1)}%</text>
      <text x="10" y={H - 12} className="fno-val">{(lo * 100).toFixed(1)}%</text>
      <text x={10} y={H + 14} className="fno-val">{k0}</text>
      <text x={W - 10} y={H + 14} textAnchor="end" className="fno-val">{k1}</text>
      <text x={W - 10} y="12" textAnchor="end" className="fno-val"><tspan fill="#0ecb81">Put IV</tspan> · <tspan fill="#f6465d">Call IV</tspan></text>
    </svg>
  );
}

/** Profit/loss at expiry for a strategy, with breakevens and spot. */
export function Payoff({ legs, spot, breakevens, span }: { legs: Leg[]; spot: number; breakevens: number[]; span: number }) {
  const lo = spot - span, hi = spot + span, W = 300, H = 120;
  const xs = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
  const ys = xs.map((s) => payoff(legs, s));
  const top = Math.max(...ys, 0), bot = Math.min(...ys, 0);
  const X = (s: number) => ((s - lo) / (hi - lo)) * W;
  const Y = (v: number) => 6 + ((top - v) / (top - bot || 1)) * (H - 12);
  const line = xs.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("");
  const area = (sign: 1 | -1) => `M${X(lo)},${Y(0)} ` + xs.map((s, i) => `L${X(s).toFixed(1)},${Y(sign > 0 ? Math.max(0, ys[i]) : Math.min(0, ys[i])).toFixed(1)}`).join(" ") + ` L${X(hi)},${Y(0)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="payoff" role="img" aria-label="Payoff at expiry">
      <path d={area(1)} fill="rgba(14,203,129,0.22)" />
      <path d={area(-1)} fill="rgba(246,70,93,0.22)" />
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="rgba(255,255,255,0.2)" />
      <path d={line} fill="none" stroke="#eaecef" strokeWidth="1.6" />
      <line x1={X(spot)} x2={X(spot)} y1="0" y2={H} stroke="#b39dfb" strokeDasharray="3 3" />
      {breakevens.filter((b) => b > lo && b < hi).map((b) => <circle key={b} cx={X(b)} cy={Y(0)} r="3" fill="#fbbf24" />)}
    </svg>
  );
}
