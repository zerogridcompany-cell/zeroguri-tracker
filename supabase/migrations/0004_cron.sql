-- 0004_cron.sql — pg_cron スケジューラ
-- tracking-tick（10分毎）と refresh-tokens（1時間毎）を Edge Function として叩く。
-- service_role_key は Supabase Vault に格納し、平文で残さない。

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ── 設定の置き場 ──
-- 本番では Vault を使う:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- ローカルでは下の helper が app.settings.* GUC を読む。db reset 後に値を設定:
--   alter database postgres set app.settings.functions_url = 'http://kong:8000/functions/v1';
--   alter database postgres set app.settings.service_role_key = '<key>';

create or replace function public.invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  key      text := current_setting('app.settings.service_role_key', true);
  req_id   bigint;
begin
  if base_url is null then
    raise notice 'app.settings.functions_url not set; skipping invoke of %', fn;
    return null;
  end if;
  select net.http_post(
    url     := base_url || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || coalesce(key, '')
               ),
    body    := body
  ) into req_id;
  return req_id;
end $$;

-- ── スケジュール ──
-- 既存ジョブがあれば貼り直し（冪等）
select cron.unschedule('zeroguri-tracking-tick')  where exists (select 1 from cron.job where jobname = 'zeroguri-tracking-tick');
select cron.unschedule('zeroguri-refresh-tokens') where exists (select 1 from cron.job where jobname = 'zeroguri-refresh-tokens');

-- 生きてる動画の計測: 10分毎（実コールは active set の due 分のみ）
select cron.schedule(
  'zeroguri-tracking-tick',
  '*/10 * * * *',
  $$ select public.invoke_edge_function('tracking-tick', '{}'::jsonb); $$
);

-- TikTok のサイレント失効監視: 1時間毎
select cron.schedule(
  'zeroguri-refresh-tokens',
  '0 * * * *',
  $$ select public.invoke_edge_function('refresh-tokens', '{}'::jsonb); $$
);
