-- Favourites: stocks pinned to the "My focus" section of the dashboard.

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('IN', 'US')),
  created_at timestamptz not null default now(),
  primary key (user_id, symbol, market)
);

alter table public.watchlist enable row level security;

drop policy if exists "own watchlist" on public.watchlist;
create policy "own watchlist" on public.watchlist for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
