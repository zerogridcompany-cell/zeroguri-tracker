-- 0055: 公開された予約投稿を自動トラッキングする sync-posted-videos を pg_cron に登録（10分毎）。冪等。
select cron.unschedule('zeroguri-sync-posted')
  where exists (select 1 from cron.job where jobname = 'zeroguri-sync-posted');
select cron.schedule(
  'zeroguri-sync-posted',
  '*/10 * * * *',
  $$ select public.invoke_edge_function('sync-posted-videos', '{}'::jsonb); $$
);
