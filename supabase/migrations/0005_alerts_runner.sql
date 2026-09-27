-- Alerts runner: Supabase's scheduler (pg_cron + pg_net) calls the app's
-- /api/alerts/run every minute with a secret that only the database knows.
-- The app passes that secret back to these functions to read what it needs;
-- a caller without the secret gets nothing.

create extension if not exists pgcrypto with schema extensions;
insert into private.config (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex')) on conflict (key) do nothing;

drop function if exists public.alert_config_get(text);
drop function if exists public.alert_config_set(text, text);

create or replace function public.alerts_due(s text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.config where key = 'cron_secret' and value = s) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private', (select value from private.config where key = 'vapid_private'),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'prefs', to_jsonb(p),
        'tz', (select st.timezone from public.settings st where st.user_id = p.user_id),
        'subs', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', x.endpoint, 'p256dh', x.p256dh, 'auth', x.auth)), '[]'::jsonb) from public.push_subscriptions x where x.user_id = p.user_id),
        'favs', (select coalesce(jsonb_agg(jsonb_build_object('symbol', w.symbol, 'market', w.market) order by w.created_at), '[]'::jsonb) from public.watchlist w where w.user_id = p.user_id)
      )) from public.alert_prefs p where p.enabled), '[]'::jsonb));
end $$;

-- Record an alert; true only the first time a key is seen (so nothing is sent twice).
create or replace function public.alerts_log(s text, uid uuid, k text, t text, b text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.config where key = 'cron_secret' and value = s) then raise exception 'forbidden'; end if;
  insert into public.alert_log (user_id, key, title, body) values (uid, k, t, b) on conflict do nothing;
  return found;
end $$;

create or replace function public.alerts_drop(s text, ep text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.config where key = 'cron_secret' and value = s) then raise exception 'forbidden'; end if;
  delete from public.push_subscriptions where endpoint = ep;
end $$;

-- Owner only (the one allowed email): push keys for subscribing and test sends.
create or replace function public.alerts_owner_keys() returns jsonb
language sql security definer set search_path = '' as $$
  select case when (auth.jwt() ->> 'email') = 'helloluxiven@gmail.com' then jsonb_build_object(
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private', (select value from private.config where key = 'vapid_private')) end $$;

create or replace function public.alerts_owner_init(pub text, priv text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (auth.jwt() ->> 'email') is distinct from 'helloluxiven@gmail.com' then raise exception 'forbidden'; end if;
  insert into private.config (key, value) values ('vapid_public', pub), ('vapid_private', priv) on conflict (key) do nothing;
  insert into public.app_public (key, value) select 'vapid_public', value from private.config where key = 'vapid_public' on conflict (key) do update set value = excluded.value;
end $$;

revoke all on function public.alerts_due(text), public.alerts_log(text, uuid, text, text, text), public.alerts_drop(text, text) from public;
grant execute on function public.alerts_due(text), public.alerts_log(text, uuid, text, text, text), public.alerts_drop(text, text) to anon, authenticated;
revoke all on function public.alerts_owner_keys(), public.alerts_owner_init(text, text) from public, anon;
grant execute on function public.alerts_owner_keys(), public.alerts_owner_init(text, text) to authenticated;

-- Every minute: call the app. The secret is read inside the database, never stored in code.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule('swing-desk-alerts') where exists (select 1 from cron.job where jobname = 'swing-desk-alerts');
select cron.schedule('swing-desk-alerts', '* * * * *', $$
  select net.http_post(
    url := 'https://swing-trading-app-seven.vercel.app/api/alerts/run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alert-secret', (select value from private.config where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$$);
