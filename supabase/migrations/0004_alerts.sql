-- Live notifications: web-push subscriptions, alert preferences, a sent log,
-- and a private config store for the server's push (VAPID) keys.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.alert_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  sweeps boolean not null default true,        -- NY sweep of a liquidity pool (XAU / forex / crypto)
  setups boolean not null default true,        -- a setup becomes ready (entry, stop, target)
  stocks boolean not null default true,        -- a favourite stock's swing setup becomes ready
  min_grade text not null default 'B' check (min_grade in ('A', 'B', 'C')),
  weekend_crypto boolean not null default false,
  quiet_start text not null default '23:00',
  quiet_end text not null default '07:00',
  updated_at timestamptz not null default now()
);
alter table public.alert_prefs enable row level security;
drop policy if exists "own prefs" on public.alert_prefs;
create policy "own prefs" on public.alert_prefs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.alert_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  title text,
  body text,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.alert_log enable row level security;
drop policy if exists "read own log" on public.alert_log;
create policy "read own log" on public.alert_log for select to authenticated using ((select auth.uid()) = user_id);

-- Public values the app may read (the VAPID public key).
create table if not exists public.app_public (key text primary key, value text not null);
alter table public.app_public enable row level security;
drop policy if exists "read public" on public.app_public;
create policy "read public" on public.app_public for select to authenticated using (true);

-- Server-only secrets: not in an exposed schema, never reachable through the API.
create schema if not exists private;
revoke all on schema private from anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
revoke all on private.config from anon, authenticated;
