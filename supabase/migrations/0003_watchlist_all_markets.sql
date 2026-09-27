-- Favourites across every desk: stocks (IN, US), forex & commodities (FX), crypto (CRYPTO).
alter table public.watchlist drop constraint if exists watchlist_market_check;
alter table public.watchlist add constraint watchlist_market_check check (market in ('IN', 'US', 'FX', 'CRYPTO'));
