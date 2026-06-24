-- 0035: 案件の累計（予算進捗 v_campaign_progress）をユーザーをまたいで合算しないように修正。
-- 1000ブロックの切り捨ては「ユーザー×案件」単位。別々の人の端数を足して1000にしてはいけない。
-- 例: ユーザー1=200再生, ユーザー2=800再生 → 各 floor → 0+0 = ¥0（合算して¥100にしない）。
create or replace view public.v_campaign_progress as
select campaign_id, status, cap_value, cap_type, unit_price, earned_views, earned_amount, cap_views, cap_factor,
  round(earned_amount * cap_factor, 0) as counted_amount,
  round(earned_amount * (1::numeric - cap_factor), 0) as over_amount,
  case
    when cap_value is null or cap_type is null then null::numeric
    when cap_type = 'amount'::text then least(100::numeric, round(earned_amount / nullif(cap_value, 0::numeric) * 100::numeric))
    else least(100::numeric, round(earned_views / nullif(cap_views, 0::numeric) * 100::numeric))
  end as progress_pct
from (
  with per_user as (
    -- ユーザー×案件ごとに合算してから 1000ブロック
    select tv.campaign_id, la.user_id,
      floor(sum(least(tv.last_views, tv.cap::bigint)::numeric) / 1000.0) * 1000::numeric as user_block_views
    from public.tracked_videos tv
    join public.linked_accounts la on la.id = tv.linked_account_id
    group by tv.campaign_id, la.user_id
  ), agg as (
    -- 案件の累計 = ユーザーごとのブロックを合計（ユーザーをまたいで端数を足さない）
    select campaign_id, sum(user_block_views) as earned_views
    from per_user group by campaign_id
  )
  select c.id as campaign_id, c.status, c.cap_value, c.cap_type, c.unit_price,
    coalesce(a.earned_views, 0::numeric) as earned_views,
    coalesce(round(a.earned_views * c.unit_price, 0), 0::numeric) as earned_amount,
    case
      when c.cap_type = 'views'::text then c.cap_value
      when c.cap_type = 'amount'::text then round(c.cap_value / nullif(c.unit_price, 0::numeric))
      else null::numeric
    end as cap_views,
    case
      when c.cap_value is null or c.cap_type is null or coalesce(a.earned_views, 0::numeric) = 0::numeric then 1::numeric
      else least(1::numeric,
        case when c.cap_type = 'views'::text then c.cap_value else c.cap_value / nullif(c.unit_price, 0::numeric) end
        / a.earned_views)
    end as cap_factor
  from public.campaigns c
    left join agg a on a.campaign_id = c.id
) p;
