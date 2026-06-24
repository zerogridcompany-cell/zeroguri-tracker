-- 0026 — アカウント連携を案件別に分離。案件削除で連携アカウント(と動画)もカスケード削除。
alter table public.linked_accounts
  add column if not exists campaign_id uuid references public.campaigns(id) on delete cascade;

-- 既存の連携アカウントは現在の案件に割り当て（案件が1つなのでそれに）
update public.linked_accounts
  set campaign_id = (select id from public.campaigns order by created_at desc limit 1)
  where campaign_id is null;

-- 同じハンドルを案件ごとに別々に連携できるよう、ユニークを (campaign_id, platform, platform_user_id) に
alter table public.linked_accounts drop constraint if exists linked_accounts_platform_platform_user_id_key;
create unique index if not exists linked_accounts_campaign_platform_user_key
  on public.linked_accounts (campaign_id, platform, platform_user_id);

-- v_account_dashboard に campaign_id を追加（末尾に追記）
create or replace view public.v_account_dashboard as
 select la.id as linked_account_id, la.user_id, la.platform, la.handle, la.status as connection_status, la.is_new_account,
    count(tv.id) as total_videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    count(*) filter (where tv.status = 'retired') as retired_videos,
    coalesce(round(sum(
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1) * tv.unit_price
    ), 0), 0::numeric) as billable_amount,
    la.campaign_id
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.id;
