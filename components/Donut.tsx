/** SVG donut for allocation. Server component — no JS shipped. */
export const PALETTE = ["#b39dfb", "#22d3ee", "#22c55e", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#a3e635", "#f43f5e", "#94a3b8"];

export default function Donut({ parts, size = 168, center }: { parts: { label: string; value: number }[]; size?: number; center?: React.ReactNode }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 15.9155; // circumference 100
  let offset = 25; // start at 12 o'clock
  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" width={size} height={size} aria-hidden>
          <circle cx="21" cy="21" r={r} fill="none" stroke="#1a1a2c" strokeWidth="5" />
          {total > 0 &&
            parts.map((p, i) => {
              const share = (p.value / total) * 100;
              const el = (
                <circle key={p.label} cx="21" cy="21" r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="5"
                  strokeDasharray={`${Math.max(0, share - 0.6)} ${100 - Math.max(0, share - 0.6)}`} strokeDashoffset={offset} />
              );
              offset -= share;
              return el;
            })}
        </svg>
        {center && <div className="donut-center">{center}</div>}
      </div>
      <ul className="donut-legend">
        {parts.map((p, i) => (
          <li key={p.label}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span>{p.label}</span>
            <b>{total ? ((p.value / total) * 100).toFixed(1) : "0"}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
