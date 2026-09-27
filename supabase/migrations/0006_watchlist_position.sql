-- Favourites can be reordered (the first three are the dashboard charts) and can
-- hold any valid ticker, so the display name is stored alongside.
alter table public.watchlist add column if not exists position integer not null default 0;
alter table public.watchlist add column if not exists name text;
