// The original sheet's "CNC Strategy" column, restored as its own lens for
// positional trades — NOT part of the swing setup score.
//
// Sheet formula (NIFTY50!O3):
//   IF(price <= low52 + 0.2*(high52-low52), "BUY FOCUS",
//   IF(price >= high52 - 0.2*(high52-low52), "SELL FOCUS", "NEUTRAL"))
//
// It buys weakness (bottom 20% of the 52-week range) while the swing setup buys
// strength (above the 50 EMA). They usually disagree, so every result also says
// whether the trend agrees, and flags it when it does not.

export type Focus52 = "BUY FOCUS" | "SELL FOCUS" | "NEUTRAL";

export type Focus52Result = {
  focus: Focus52;
  rangePos: number; // 0 = at the 52-week low, 1 = at the high
  trendAgrees: boolean | null; // null when NEUTRAL
  note: string;
};

export function focus52(price: number, low52: number, high52: number, ema50: number): Focus52Result {
  const span = high52 - low52;
  const rangePos = span > 0 ? (price - low52) / span : 0.5;
  let focus: Focus52 = "NEUTRAL";
  if (span > 0 && price <= low52 + 0.2 * span) focus = "BUY FOCUS";
  else if (span > 0 && price >= high52 - 0.2 * span) focus = "SELL FOCUS";

  if (focus === "NEUTRAL") return { focus, rangePos, trendAgrees: null, note: "Middle of its 52-week range." };
  const above50 = price > ema50;
  if (focus === "BUY FOCUS") {
    return above50
      ? { focus, rangePos, trendAgrees: true, note: "Near the 52-week low AND back above the 50 EMA — the rare case where both lenses agree." }
      : { focus, rangePos, trendAgrees: false, note: "Near the 52-week low but below the 50 EMA — buying a falling stock. Positional only, size small, not a swing setup." };
  }
  return above50
    ? { focus, rangePos, trendAgrees: false, note: "Near the 52-week high but still above the 50 EMA — strength; a short here fights the trend." }
    : { focus, rangePos, trendAgrees: true, note: "Near the 52-week high and below the 50 EMA — rolling over; both lenses lean short." };
}
