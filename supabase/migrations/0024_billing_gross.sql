-- 0024_billing_gross.sql — 課金ビューを gross（総獲得）に戻す。支払いは payout_requests(paid) の合計で管理。
-- 旧 per-video 台帳(video_payout_ledger)は使わない（mark_payout_paid の全額記録バグを撤去）。
-- 「稼いだ金額」= gross（cap_factor 適用、台帳は引かない）。残高 = gross − 支払い済み − 保留中 はアプリ側で計算。

drop view if exists public.v_billable;
create view public.v_billable as
 select tv.id as tracked_video_id, tv.campaign_id, tv.linked_account_id, tv.platform, tv.content_id, tv.title,
    tv.last_views as attributable_views, tv.peak_views, tv.cap,
    (floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000)::bigint as billable_views,
    tv.unit_price,
    round(floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * tv.unit_price, 0) as billable_amount,
    tv.status, tv.retired_reason, tv.anomaly_flag, tv.next_check_at, tv.last_checked_at,
    case
      when tv.anomaly_flag is not null and tv.status = 'active' then 'review'
      when tv.status = 'active' and tv.stall_count >= 1 then 'slowing'
      when tv.status = 'active' then 'tracking'
      when tv.retired_reason = 'cap' then 'completed'
      else 'retired'
    end as display_status
 from public.tracked_videos tv;

create or replace view public.v_account_dashboard as
 select la.id as linked_account_id, la.user_id, la.platform, la.handle, la.status as connection_status, la.is_new_account,
    count(tv.id) as total_videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    count(*) filter (where tv.status = 'retired') as retired_videos,
    coalesce(round(sum(
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1) * tv.unit_price
    ), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.id;

create or replace view public.v_user_totals as
 select la.user_id,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(round(sum(
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1) * tv.unit_price
    ), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.user_id;

create or replace view public.v_user_platform as
 select la.user_id, la.platform,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)), 0::numeric) as billable_views,
    coalesce(round(sum(
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1) * tv.unit_price
    ), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by la.user_id, la.platform;

create or replace view public.v_campaign_creators as
 select tv.campaign_id, la.user_id as creator_id, au.email as creator_email, la.platform, la.handle,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1)), 0::numeric) as billable_views,
    coalesce(round(sum(
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * coalesce(cp.cap_factor, 1) * tv.unit_price
    ), 0), 0::numeric) as billable_amount
 from public.tracked_videos tv
 join public.linked_accounts la on la.id = tv.linked_account_id
 left join public.app_users au on au.id = la.user_id
 left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
 group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

-- mark_payout_paid: 台帳記録をやめ、リクエストを paid にするだけ（支払い合計は payout_requests から集計）
create or replace function public.mark_payout_paid(p_request_id uuid, p_fee numeric)
returns public.payout_requests
language plpgsql security definer set search_path = public as $$
declare v_req public.payout_requests; v_email text;
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
  return v_req;
end $$;
grant execute on function public.mark_payout_paid(uuid, numeric) to authenticated;
