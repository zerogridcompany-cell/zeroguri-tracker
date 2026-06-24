-- 0034: 課金の切り捨てを「1動画ごと」から「合算してから1000ブロック」に変更。
-- 個別動画の表示は引き続き 1000未満=¥0（per-video floor）だが、稼いだ額の“合計”は
-- (ユーザー×案件)で全動画の再生数を合算してから floor(合計/1000)*1000 する。
-- 例: 合計65,099再生 → 65,000ブロック → ¥6,500（端数を個別に捨てない）。
-- 合計が1000未満なら ¥0（例: 合計731再生 → ¥0）。
--
-- net_raw（動画あたり・未floor・台帳差引後） = greatest(0, least(last_views,cap) − paid_views)
-- 集計ビューは floor(sum(net_raw)/1000)*1000 * unit_price * cap_factor で算出。

-- 1) v_billable: 個別表示は per-video floor のまま。集計用に net_views（未floor）を末尾に追加。
create or replace view public.v_billable as
select tv.id as tracked_video_id,
  tv.campaign_id, tv.linked_account_id, tv.platform, tv.content_id, tv.title,
  tv.last_views as attributable_views, tv.peak_views, tv.cap,
  greatest(0::numeric,
    floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
    - coalesce(l.paid_views, 0)::numeric)::bigint as billable_views,
  tv.unit_price,
  round(greatest(0::numeric,
    floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
    - coalesce(l.paid_views, 0)::numeric) * tv.unit_price, 0) as billable_amount,
  tv.status, tv.retired_reason, tv.anomaly_flag, tv.next_check_at, tv.last_checked_at,
  case
    when tv.anomaly_flag is not null and tv.status = 'active'::text then 'review'::text
    when tv.status = 'active'::text and tv.stall_count >= 1 then 'slowing'::text
    when tv.status = 'active'::text then 'tracking'::text
    when tv.retired_reason = 'cap'::text then 'completed'::text
    else 'retired'::text
  end as display_status,
  greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)::bigint as net_views
from public.tracked_videos tv
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id;

-- 2) v_campaign_progress: 予算進捗（gross）。案件全体で合算してから 1000ブロック。
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
  with agg as (
    select tv.campaign_id,
      floor(sum(least(tv.last_views, tv.cap::bigint)::numeric) / 1000.0) * 1000::numeric as earned_views
      from public.tracked_videos tv group by tv.campaign_id
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

-- 3) v_user_campaign_billing（新規・基準）: (ユーザー×案件) で合算してから 1000ブロック。
create or replace view public.v_user_campaign_billing as
select la.user_id, tv.campaign_id,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  (floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric) as billable_views,
  coalesce(round(
    floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric) * coalesce(max(tv.unit_price), 0::numeric)
  ), 0) as billable_amount
from public.linked_accounts la
  join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.user_id, tv.campaign_id;

-- 4) v_user_totals: 案件ごとに合算済みの billable を、ユーザーで合計（= 稼いだ額）
create or replace view public.v_user_totals as
select user_id,
  sum(videos)::bigint as videos,
  sum(active_videos)::bigint as active_videos,
  sum(total_views) as total_views,
  coalesce(round(sum(billable_amount)), 0::numeric) as billable_amount
from public.v_user_campaign_billing
group by user_id;

-- 5) v_account_dashboard: アカウント（=1案件）ごとに合算してから 1000ブロック
create or replace view public.v_account_dashboard as
select la.id as linked_account_id, la.user_id, la.platform, la.handle,
  la.status as connection_status, la.is_new_account,
  count(tv.id) as total_videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  count(*) filter (where tv.status = 'retired'::text) as retired_videos,
  coalesce(round(
    floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric) * coalesce(max(tv.unit_price), 0::numeric)
  ), 0) as billable_amount,
  la.campaign_id
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.id;

-- 6) v_campaign_creators: (案件×クリエイター×プラットフォーム) ごとに合算してから 1000ブロック
create or replace view public.v_campaign_creators as
select tv.campaign_id, la.user_id as creator_id, au.email as creator_email,
  la.platform, la.handle,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  (floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric)) as billable_views,
  coalesce(round(
    floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric) * coalesce(max(tv.unit_price), 0::numeric)
  ), 0) as billable_amount
from public.tracked_videos tv
  join public.linked_accounts la on la.id = tv.linked_account_id
  left join public.app_users au on au.id = la.user_id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

-- 7) v_user_platform: (ユーザー×プラットフォーム) ごとに合算してから 1000ブロック
create or replace view public.v_user_platform as
select la.user_id, la.platform,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  (floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric)) as billable_views,
  coalesce(round(
    floor(sum(greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)) / 1000.0) * 1000::numeric
    * coalesce(max(cp.cap_factor), 1::numeric) * coalesce(max(tv.unit_price), 0::numeric)
  ), 0) as billable_amount
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.user_id, la.platform;

-- 8) mark_payout_paid: 支払い済み高水位は未floorの正味再生数 least(last_views,cap) で記録
--    （集計側で合算してから floor するため、台帳は端数も保持する）
create or replace function public.mark_payout_paid(p_request_id uuid, p_fee numeric)
returns public.payout_requests
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_req public.payout_requests;
  v_email text;
  v_cap_factor numeric;
  rec record;
  v_old bigint;
  v_delta_amt numeric;
begin
  select au.email into v_email from public.app_users au where au.id = auth.uid();
  if not exists (select 1 from public.organizer_emails oe where lower(oe.email) = lower(coalesce(v_email,'__none__'))) then
    raise exception 'forbidden: organizer only';
  end if;

  update public.payout_requests
     set status = 'paid', fee = coalesce(p_fee, fee), paid_at = now()
   where id = p_request_id
   returning * into v_req;
  if v_req.id is null then raise exception 'payout request not found'; end if;

  if v_req.campaign_id is not null then
    select coalesce(cap_factor, 1) into v_cap_factor from public.v_campaign_progress where campaign_id = v_req.campaign_id;
    v_cap_factor := coalesce(v_cap_factor, 1);

    for rec in
      select tv.platform, tv.content_id, tv.title, tv.unit_price, la.handle,
             least(tv.last_views, tv.cap::bigint)::bigint as gross_bv
        from public.tracked_videos tv
        join public.linked_accounts la on la.id = tv.linked_account_id
       where la.user_id = v_req.user_id and tv.campaign_id = v_req.campaign_id
    loop
      select coalesce(paid_views, 0) into v_old from public.video_payout_ledger
       where campaign_id = v_req.campaign_id and platform = rec.platform and content_id = rec.content_id;
      v_old := coalesce(v_old, 0);

      if rec.gross_bv > v_old then
        v_delta_amt := round((rec.gross_bv - v_old) * rec.unit_price * v_cap_factor);
        insert into public.video_payout_ledger
          (campaign_id, user_id, platform, content_id, handle, title, paid_views, paid_amount, last_payout_request_id, last_paid_at, updated_at)
        values
          (v_req.campaign_id, v_req.user_id, rec.platform, rec.content_id, rec.handle, rec.title, rec.gross_bv, v_delta_amt, p_request_id, now(), now())
        on conflict (campaign_id, platform, content_id) do update
          set paid_views = rec.gross_bv,
              paid_amount = public.video_payout_ledger.paid_amount + v_delta_amt,
              handle = excluded.handle,
              title = coalesce(excluded.title, public.video_payout_ledger.title),
              user_id = excluded.user_id,
              last_payout_request_id = excluded.last_payout_request_id,
              last_paid_at = now(),
              updated_at = now();
      end if;
    end loop;
  end if;

  return v_req;
end $function$;
