-- 0038: 課金を cap_factor（遡及按分）から credited（確定台帳）ベースへ切替。
-- ・各ユーザーの確定 billable = floor(credited_views/1000)*1000 × unit_price（確定ロック・キャップ反映）。
-- ・稼いだ額(net) = 確定 gross − 既払い（payout_requests.amount の paid 合計）。
-- ・キャップ未到達時は credited=生 なので現在の数字は不変。

-- v_billable: 1動画ごとの表示は gross の1000ブロック（1000未満=¥0）。台帳差引はしない（既払いはユーザー単位で扱う）。
create or replace view public.v_billable as
select tv.id as tracked_video_id,
  tv.campaign_id, tv.linked_account_id, tv.platform, tv.content_id, tv.title,
  tv.last_views as attributable_views, tv.peak_views, tv.cap,
  (floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000)::bigint as billable_views,
  tv.unit_price,
  round(floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * tv.unit_price, 0) as billable_amount,
  tv.status, tv.retired_reason, tv.anomaly_flag, tv.next_check_at, tv.last_checked_at,
  case
    when tv.anomaly_flag is not null and tv.status = 'active'::text then 'review'::text
    when tv.status = 'active'::text and tv.stall_count >= 1 then 'slowing'::text
    when tv.status = 'active'::text then 'tracking'::text
    when tv.retired_reason = 'cap'::text then 'completed'::text
    else 'retired'::text
  end as display_status,
  least(tv.last_views, tv.cap::bigint)::bigint as net_views
from public.tracked_videos tv;

-- v_campaign_progress: credited ベース（cap_factor は廃止＝1固定で互換維持）
create or replace view public.v_campaign_progress as
with cur as (
  select tv.campaign_id, la.user_id,
    floor(sum(least(tv.last_views, tv.cap::bigint))/1000.0)*1000 as cur_block
  from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
  group by tv.campaign_id, la.user_id
),
agg as (
  select cu.campaign_id,
    sum(floor(coalesce(cuc.credited_views,0)/1000.0)*1000) as credited_block,
    sum(cu.cur_block) as cur_block_total
  from cur cu left join public.campaign_user_credit cuc on cuc.campaign_id=cu.campaign_id and cuc.user_id=cu.user_id
  group by cu.campaign_id
)
select c.id as campaign_id, c.status, c.cap_value, c.cap_type, c.unit_price,
  coalesce(a.credited_block,0) as earned_views,
  coalesce(round(a.credited_block * c.unit_price,0),0) as earned_amount,
  case when c.cap_type='views' then c.cap_value when c.cap_type='amount' then round(c.cap_value/nullif(c.unit_price,0)) else null end as cap_views,
  1::numeric as cap_factor,
  coalesce(round(a.credited_block * c.unit_price,0),0) as counted_amount,
  coalesce(round(greatest(0, a.cur_block_total - a.credited_block) * c.unit_price,0),0) as over_amount,
  case
    when c.cap_value is null or c.cap_type is null then null::numeric
    when c.cap_type='amount' then least(100::numeric, round(coalesce(a.credited_block,0)*c.unit_price/nullif(c.cap_value,0)*100))
    else least(100::numeric, round(coalesce(a.credited_block,0)/nullif(c.cap_value,0)*100))
  end as progress_pct
from public.campaigns c left join agg a on a.campaign_id=c.id;

-- v_user_campaign_billing: 確定 gross（floor(credited)×unit_price）
create or replace view public.v_user_campaign_billing as
select la.user_id, tv.campaign_id,
  count(tv.id) as videos,
  count(*) filter (where tv.status='active') as active_videos,
  coalesce(sum(tv.last_views),0) as total_views,
  (floor(coalesce(max(cuc.credited_views),0)/1000.0)*1000) as billable_views,
  coalesce(round(floor(coalesce(max(cuc.credited_views),0)/1000.0)*1000 * max(tv.unit_price)),0) as billable_amount
from public.linked_accounts la
join public.tracked_videos tv on tv.linked_account_id=la.id
left join public.campaign_user_credit cuc on cuc.campaign_id=tv.campaign_id and cuc.user_id=la.user_id
group by la.user_id, tv.campaign_id;

-- v_user_totals: 稼いだ額(net) = 確定 gross 合計 − 既払い(payout_requests.amount の paid 合計)
create or replace view public.v_user_totals as
select b.user_id,
  sum(b.videos)::bigint as videos,
  sum(b.active_videos)::bigint as active_videos,
  sum(b.total_views) as total_views,
  greatest(0::numeric, coalesce(sum(b.billable_amount),0) - coalesce(max(p.paid),0)) as billable_amount
from public.v_user_campaign_billing b
left join (select user_id, sum(amount) as paid from public.payout_requests where status='paid' group by user_id) p
  on p.user_id = b.user_id
group by b.user_id;

-- 内訳ビュー: cap_factor 撤去（生1000ブロック×unit_price）。キャップ未到達時は credited と一致。
create or replace view public.v_account_dashboard as
select la.id as linked_account_id, la.user_id, la.platform, la.handle,
  la.status as connection_status, la.is_new_account,
  count(tv.id) as total_videos,
  count(*) filter (where tv.status='active') as active_videos,
  count(*) filter (where tv.status='retired') as retired_videos,
  coalesce(round(floor(sum(least(tv.last_views,tv.cap::bigint))/1000.0)*1000 * max(tv.unit_price)),0) as billable_amount,
  la.campaign_id
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id=la.id
group by la.id;

create or replace view public.v_campaign_creators as
select tv.campaign_id, la.user_id as creator_id, au.email as creator_email, la.platform, la.handle,
  count(tv.id) as videos,
  count(*) filter (where tv.status='active') as active_videos,
  coalesce(sum(tv.last_views),0) as total_views,
  floor(sum(least(tv.last_views,tv.cap::bigint))/1000.0)*1000 as billable_views,
  coalesce(round(floor(sum(least(tv.last_views,tv.cap::bigint))/1000.0)*1000 * max(tv.unit_price)),0) as billable_amount
from public.tracked_videos tv
  join public.linked_accounts la on la.id=tv.linked_account_id
  left join public.app_users au on au.id=la.user_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

create or replace view public.v_user_platform as
select la.user_id, la.platform,
  count(tv.id) as videos,
  count(*) filter (where tv.status='active') as active_videos,
  coalesce(sum(tv.last_views),0) as total_views,
  floor(sum(least(tv.last_views,tv.cap::bigint))/1000.0)*1000 as billable_views,
  coalesce(round(floor(sum(least(tv.last_views,tv.cap::bigint))/1000.0)*1000 * max(tv.unit_price)),0) as billable_amount
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id=la.id
group by la.user_id, la.platform;
