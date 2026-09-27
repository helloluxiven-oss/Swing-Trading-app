// Back-compat wrappers for gold (XAUUSD) over the generic feeds.
import "server-only";
import { calendar, candles, headlines, TFS, type Tf } from "./feeds";
import { findInstrument } from "./instruments";

export { TFS, type Tf };
const XAU = () => findInstrument("fx", "XAUUSD");
export const goldCandles = () => candles(XAU(), "5m");
export const goldChart = (tf: Tf) => candles(XAU(), tf);
export const goldNews = (limit = 12) => headlines(XAU().query, limit);
export const usdEvents = () => calendar(["USD"]);
