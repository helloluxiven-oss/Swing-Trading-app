// Today's options call for one underlying — shared by the F&O page and the dashboard.
import "server-only";
import { fiiDii, getChain, UNDERLYINGS, type Underlying } from "./derivs";
import { analyseChain, yearsTo } from "./options";
import { realisedVol } from "./strategies";
import { decide, newsLean } from "./decision";
import { headlines } from "./feeds";
import { getIntraday } from "./market";
import { headlineLean } from "./liquidity";

export const SPOT_SYMBOL: Record<Underlying, string> = { NIFTY: "^NSEI", SENSEX: "^BSESN", BTC: "BTC-USD", ETH: "ETH-USD" };
export const NEWS_QUERY: Record<Underlying, string> = {
  NIFTY: "Nifty options OR Nifty 50 OR F&O expiry",
  SENSEX: "Sensex options OR Sensex expiry OR BSE Sensex",
  BTC: "bitcoin options OR bitcoin price OR BTC",
  ETH: "ethereum options OR ethereum price OR ETH",
};

export async function todayCall(u: Underlying, expiry?: number) {
  const meta = UNDERLYINGS.find((x) => x.id === u)!;
  const india = meta.market === "india";
  const [chain, daily, news, flows] = await Promise.all([
    getChain(u, expiry),
    getIntraday(SPOT_SYMBOL[u], "1d", "6mo", 900),
    headlines(NEWS_QUERY[u], 12),
    india ? fiiDii() : Promise.resolve(null),
  ]);
  if (!chain || !chain.rows.length) return { meta, chain: null, news, flows, decision: null, a: null, T: 0, rv: null, closes: [] as number[] };
  const T = yearsTo(chain.expiry);
  const fmt = (x: number) => `${meta.currency}${x.toLocaleString(india ? "en-IN" : "en-US", { maximumFractionDigits: 0 })}`;
  const a = analyseChain(chain.rows, chain.spot, T, fmt);
  const closes = (daily?.candles ?? []).map((c) => c.c);
  const rv = realisedVol(closes, 30, india ? 252 : 365);
  const step = chain.rows.length > 1 ? chain.rows[1].strike - chain.rows[0].strike : 1;
  const perp = chain.futures.find((f) => f.name === "Perpetual");
  const decision = decide({
    spot: chain.spot, T, rows: chain.rows, a, ivAtm: a.atmIV, rv, closes,
    flows: flows ? { fiiNet: flows.fiiNet, diiNet: flows.diiNet } : null,
    funding8h: perp?.funding8h ?? null,
    news: newsLean(news.map((n) => n.title), headlineLean),
    step,
  });
  return { meta, chain, news, flows, decision, a, T, rv, closes };
}
