-- Swing trading app: settings, trades (the journal) and holdings.
-- Every table is private to its owner through row-level security.

create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  capital_inr numeric not null default 100000 check (capital_inr >= 0),
  capital_usd numeric not null default 1000 check (capital_usd >= 0),
  risk_pct numeric not null default 1 check (risk_pct > 0 and risk_pct <= 5),
  rr numeric not null default 2 check (rr >= 1 and rr <= 5),
  stop_mode text not null default 'smart' check (stop_mode in ('smart', 'swing', 'fixed')),
  fixed_stop_pct numeric not null default 2 check (fixed_stop_pct > 0 and fixed_stop_pct <= 10),
  timezone text not null default 'Asia/Kolkata',
  office_start text not null default '09:30' check (office_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  office_end text not null default '18:00' check (office_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  office_days int[] not null default '{1,2,3,4,5}',
  max_consecutive_losses int not null default 2 check (max_consecutive_losses between 1 and 10),
  updated_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('IN', 'US')),
  side text not null check (side in ('long', 'short')),
  entry numeric not null check (entry > 0),
  stop numeric not null check (stop > 0),
  target numeric not null check (target > 0),
  qty numeric not null check (qty > 0),
  setup_status text not null,
  checklist jsonb not null default '{}'::jsonb,
  plan_note text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  exit_price numeric check (exit_price is null or exit_price > 0),
  closed_at timestamptz,
  result_r numeric,
  followed_plan boolean,
  lesson text,
  check (side = 'long' and stop < entry and target > entry or side = 'short' and stop > entry and target < entry)
);

create index if not exists trades_user_created on public.trades (user_id, created_at desc);
create index if not exists trades_user_closed on public.trades (user_id, closed_at desc) where status = 'closed';

-- "Once you have decided your TP and SL, let the trade run — don't change it."
-- The plan columns are frozen at insert. Only the closing fields may change,
-- and a trade can be closed or cancelled once, never reopened.
create or replace function public.trades_lock_plan() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.symbol is distinct from old.symbol or new.market is distinct from old.market
     or new.side is distinct from old.side or new.entry is distinct from old.entry
     or new.stop is distinct from old.stop or new.target is distinct from old.target
     or new.qty is distinct from old.qty or new.setup_status is distinct from old.setup_status
     or new.checklist is distinct from old.checklist or new.created_at is distinct from old.created_at
     or new.user_id is distinct from old.user_id then
    raise exception 'The plan is locked: entry, stop-loss, target and size cannot change after the trade is taken.';
  end if;
  if old.status <> 'open' then
    raise exception 'This trade is already %.', old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trades_lock_plan on public.trades;
create trigger trades_lock_plan before update on public.trades
for each row execute function public.trades_lock_plan();

create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('IN', 'US')),
  qty numeric not null check (qty > 0),
  avg_price numeric not null check (avg_price > 0),
  bought_on date,
  sector text,
  created_at timestamptz not null default now()
);

create index if not exists holdings_user on public.holdings (user_id);

alter table public.settings enable row level security;
alter table public.trades enable row level security;
alter table public.holdings enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own trades read" on public.trades;
create policy "own trades read" on public.trades for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own trades insert" on public.trades;
create policy "own trades insert" on public.trades for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "own trades update" on public.trades;
create policy "own trades update" on public.trades for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- no delete policy: the journal is append-only; cancel instead of deleting.

drop policy if exists "own holdings" on public.holdings;
create policy "own holdings" on public.holdings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
