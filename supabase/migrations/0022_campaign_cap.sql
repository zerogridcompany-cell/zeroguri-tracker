-- 0022_campaign_cap.sql — 案件（campaign）レベルの予算キャップ
-- cap_value + cap_type('amount'|'views')。案件の総獲得(gross)を上限まで計上、超過は「赤(未計上)」。
-- 残高ビューは cap_factor を掛けて上限を反映（キャップ無し=係数1で従来通り＝後方互換）。

alter table public.campaigns add column if not exists cap_value numeric;     -- null=上限なし
alter table public.campaigns add column if not exists cap_type text;          -- 'amount' | 'views' | null
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_cap_type_check') then
    alter table public.campaigns
      add constraint campaigns_cap_type_check check (cap_type is null or cap_type in ('amount', 'views'));
  end if;
end $$;

-- 案件の進捗: earned=総獲得(gross), counted=上限まで, over=超過(赤), cap_factor=按分係数
create or replace view public.v_campaign_progress as
select p.*,
  round(p.earned_amount * p.cap_factor, 0) as counted_amount,
  round(p.earned_amount * (1 - p.cap_factor), 0) as over_amount,
  case
    when p.cap_value is null or p.cap_type is null then null
    when p.cap_type = 'amount' then least(100, round(p.earned_amount / nullif(p.cap_value, 0) * 100))
    else least(100, round(p.earned_views::numeric / nullif(p.cap_views, 0) * 100))
  end as progress_pct
from (
  with pv as (
    select tv.campaign_id,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 as gbv
    from public.tracked_videos tv
  ),
  agg as (select campaign_id, sum(gbv) as earned_views from pv group by campaign_id)
  select c.id as campaign_id, c.status, c.cap_value, c.cap_type, c.unit_price,
    coalesce(a.earned_views, 0) as earned_views,
    coalesce(round(a.earned_views * c.unit_price, 0), 0) as earned_amount,
    case
      when c.cap_type = 'views' then c.cap_value
      when c.cap_type = 'amount' then round(c.cap_value / nullif(c.unit_price, 0))
      else null
    end as cap_views,
    case
      when c.cap_value is null or c.cap_type is null or coalesce(a.earned_views, 0) = 0 then 1::numeric
      else least(
        1::numeric,
        (case when c.cap_type = 'views' then c.cap_value else c.cap_value / nullif(c.unit_price, 0) end)
        / a.earned_views
      )
    end as cap_factor
  from public.campaigns c
  left join agg a on a.campaign_id = c.id
) p;

-- ───────── 残高/集計ビューに cap_factor を適用（gross×factor − paid を price 倍） ─────────

create or replace view public.v_account_dashboard as
 select la.id as linked_account_id, la.user_id, la.platform, la.handle, la.status as connection_status, la.is_new_account,
    count(tv.id) as total_videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    count(*) filter (where tv.status = 'retired') as retired_videos,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.id;

create or replace view public.v_user_totals as
 select la.user_id,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.user_id;

create or replace view public.v_user_platform as
 select la.user_id, la.platform,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric)), 0::numeric) as billable_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.user_id, la.platform;

create or replace view public.v_campaign_creators as
 select tv.campaign_id, la.user_id as creator_id, au.email as creator_email, la.platform, la.handle,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric)), 0::numeric) as billable_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.tracked_videos tv
 join public.linked_accounts la on la.id = tv.linked_account_id
 left join public.app_users au on au.id = la.user_id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;
