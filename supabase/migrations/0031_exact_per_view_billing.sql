-- 0031: 課金を「1000再生単位で切り捨て」から「1再生=単価×1 で正確計上」に変更。
-- 旧: floor(least(last_views,cap)/1000)*1000 → 小さい動画やクリップで端数(最大999再生/本)が
--     大量に捨てられ、合計が実際より少なくなっていた（例: 合計64,432再生で¥6,000）。
-- 新: least(last_views,cap) をそのまま使い、合計×単価で正確に計上（例: 64,432×0.1=¥6,443）。
-- 影響する全ビュー＋mark_payout_paid を更新。予算進捗(v_campaign_progress)も総額のまま正確化。

-- 1) v_billable（動画ごと・台帳で支払い済み分を差し引く net）
create or replace view public.v_billable as
select tv.id as tracked_video_id,
  tv.campaign_id, tv.linked_account_id, tv.platform, tv.content_id, tv.title,
  tv.last_views as attributable_views, tv.peak_views, tv.cap,
  greatest(0::numeric,
    least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)::bigint as billable_views,
  tv.unit_price,
  round(greatest(0::numeric,
    least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric) * tv.unit_price, 0) as billable_amount,
  tv.status, tv.retired_reason, tv.anomaly_flag, tv.next_check_at, tv.last_checked_at,
  case
    when tv.anomaly_flag is not null and tv.status = 'active'::text then 'review'::text
    when tv.status = 'active'::text and tv.stall_count >= 1 then 'slowing'::text
    when tv.status = 'active'::text then 'tracking'::text
    when tv.retired_reason = 'cap'::text then 'completed'::text
    else 'retired'::text
  end as display_status
from public.tracked_videos tv
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id;

-- 2) v_account_dashboard（アカウントごと net 合計）
create or replace view public.v_account_dashboard as
select la.id as linked_account_id, la.user_id, la.platform, la.handle,
  la.status as connection_status, la.is_new_account,
  count(tv.id) as total_videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  count(*) filter (where tv.status = 'retired'::text) as retired_videos,
  coalesce(round(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount,
  la.campaign_id
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.id;

-- 3) v_user_totals（ユーザーごと net 合計 = 稼いだ額）
create or replace view public.v_user_totals as
select la.user_id,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  coalesce(round(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.user_id;

-- 4) v_campaign_creators（案件×クリエイターごと net 合計）
create or replace view public.v_campaign_creators as
select tv.campaign_id, la.user_id as creator_id, au.email as creator_email,
  la.platform, la.handle,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  coalesce(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric)), 0::numeric) as billable_views,
  coalesce(round(sum(
    greatest(0::numeric, least(tv.last_views, tv.cap::bigint)::numeric - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
from public.tracked_videos tv
  join public.linked_accounts la on la.id = tv.linked_account_id
  left join public.app_users au on au.id = la.user_id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

-- 5) v_campaign_progress（予算進捗・総額/gross。earned_views を正確化）
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
  with pv as (
    select tv.campaign_id, least(tv.last_views, tv.cap::bigint)::numeric as gbv
      from public.tracked_videos tv
  ), agg as (
    select pv.campaign_id, sum(pv.gbv) as earned_views from pv group by pv.campaign_id
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
        case
          when c.cap_type = 'views'::text then c.cap_value
          else c.cap_value / nullif(c.unit_price, 0::numeric)
        end / a.earned_views)
    end as cap_factor
  from public.campaigns c
    left join agg a on a.campaign_id = c.id
) p;

-- 6) mark_payout_paid: 支払い済み高水位も正確な再生数(least(last_views,cap))で記録
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
