-- 0032: v_user_platform（organizer-members のプラットフォーム別表示）も
-- 1000切り捨てを外して正確計上にし、台帳で支払い済み分を差し引く net に統一。
create or replace view public.v_user_platform as
select la.user_id, la.platform,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  coalesce(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric)), 0::numeric) as billable_views,
  coalesce(round(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.user_id, la.platform;
