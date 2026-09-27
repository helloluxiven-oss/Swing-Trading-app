# Swing Desk

A private web app for swing trading India (NSE, NIFTY 50) and US stocks. It checks
live market data against your own setup rules, turns a passing setup into a plan
(entry, stop-loss, target, size), and will not let you log a trade that breaks
your rules.

Built from the "Indicator Setup", "Cheat Code", "MyPortfolio" and "Day Trading
Journal" sheets of the original Google Sheet, and tightened where the journal
showed the sheet letting bad trades through.

It is not investment advice, it does not predict prices, and it does not place
orders with any broker.

## What it does

| Screen | What you get |
|---|---|
| **Today** | NIFTY 50 and S&P 500 trend, today's setups in both markets, whether the gate is open (office hours, losing streak) |
| **Scanner** | Every stock in the universe, with a pass/fail for each rule, sorted by setup strength then relative strength |
| **Stock** | Daily chart with 20/50 EMA and volume, every rule with the numbers behind it, the trade plan, the discipline gate |
| **Journal** | Open trades with live R, close with exit price and "did you follow the plan?", win rate split by followed vs broken |
| **Portfolio** | Holdings with live P/L, total in INR at today's USD/INR, trend check per holding |
| **Rules** | Capital, risk per trade, reward:risk, stop method, office hours, losing-streak limit |

## The setup rules (v2)

Daily candles, last **completed** session, aiming at 3–10 day moves.

Required for **Setup ready** (long; short is the mirror image):

1. **Trend** — close above the 50 EMA
2. **Pullback** — a low within 1.5% of the 20 EMA in the last 3 sessions, closing above the 50 EMA every time
3. **RSI** — 14-day RSI dipped into 38–52 in the last 3 sessions and is rising
4. **Candle** — a green candle closing within 3% of the 20 EMA
5. **Market** — the index (NIFTY 50 / S&P 500) is above its own 50 EMA *(new in v2)*

**Setup confirmed** also needs:

6. **Volume** — above its 20-day average
7. **Relative strength** — the stock beat its index over ~3 months *(new in v2)*

**Plan**: entry one tick above the signal candle's high; stop below the 10-day
swing low, pushed out to at least 1 ATR from entry *(new in v2)*; target at
1:2 by default; size so a stop-out loses your chosen % of capital.

**Gate** — a trade can only be logged when all of these pass, with no override:
it is a ready/confirmed setup, it is with the trend, it is outside office hours,
you answered "no" to FOMO / revenge / fear / greed, you are not on a losing
streak today, and the stop and target are set. Once logged, the database refuses
any change to entry, stop, target or size.

### Changes from the original sheet

- **Added** a market filter, relative strength, an ATR-aware stop, and
  completed-candles-only evaluation.
- **Dropped** "BUY FOCUS near the 52-week low": it contradicted the Indicator
  Setup (buy weakness vs buy strength above the 50 EMA). The 52-week position is
  still shown as context.
- **Fixed** the FO screener's "NEAR LOW", which compared each stock to the next
  row's 52-week low.

## Data

Prices and daily candles come from Yahoo Finance's public chart endpoint,
server-side, cached for a few minutes. US quotes are near real-time; NSE quotes
on free feeds usually run about 15 minutes behind. Every screen shows the quote
time. For true real-time NSE, a broker API (Upstox, Dhan, Zerodha) can replace
`lib/market.ts`.

## Stack

Next.js 16 (App Router) on Vercel · Supabase (Postgres + Auth, row-level security) ·
lightweight-charts.

```
lib/indicators.ts   EMA, SMA, RSI, ATR, swing points, candle patterns
lib/setup.ts        the v2 rules → pass/fail per rule, status per side
lib/plan.ts         entry / stop / target / size, result in R
lib/gate.ts         the discipline gate (office hours, streak, emotions)
lib/market.ts       Yahoo Finance fetch, completed vs forming candle
lib/scan.ts         one pass over a market, index first
app/actions.ts      every write; re-runs setup, plan and gate on the server
supabase/migrations the schema, RLS, and the plan-lock trigger
tests/              the rules against hand-worked numbers
```

## Running it

Environment variables (Vercel → Settings → Environment Variables):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `ALLOWED_EMAIL` | the one email allowed to sign in |

```
npm install
npm test          # rule tests
npm run typecheck
npm run build
```

Apply `supabase/migrations/0001_init.sql` to the Supabase project once.
