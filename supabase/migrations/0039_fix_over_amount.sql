-- 0039: v_campaign_progress の over（赤・超過分）を「キャップ超過分のみ」に修正。
-- 旧式は cur_block - credited を over にしていたため、配分ラグ（未確定だがキャップ内）まで赤になっていた。
-- 正: over = max(0, cur_block_total - cap_views)（キャップを本当に超えた分だけ）。
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
  (case when c.cap_type='views' then c.cap_value when c.cap_type='amount' then round(c.cap_value/nullif(c.unit_price,0)) else null end) as cap_views,
  1::numeric as cap_factor,
  coalesce(round(a.credited_block * c.unit_price,0),0) as counted_amount,
  coalesce(round(
    greatest(0, a.cur_block_total - (case when c.cap_type='views' then c.cap_value when c.cap_type='amount' then round(c.cap_value/nullif(c.unit_price,0)) else a.cur_block_total end))
    * c.unit_price, 0), 0) as over_amount,
  case
    when c.cap_value is null or c.cap_type is null then null::numeric
    when c.cap_type='amount' then least(100::numeric, round(coalesce(a.credited_block,0)*c.unit_price/nullif(c.cap_value,0)*100))
    else least(100::numeric, round(coalesce(a.credited_block,0)/nullif(c.cap_value,0)*100))
  end as progress_pct
from public.campaigns c left join agg a on a.campaign_id=c.id;
