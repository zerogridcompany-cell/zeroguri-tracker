-- 0017_payout_ledger.sql — 支払い済み再生数を動画(platform,content_id)ごとに記録。
-- 削除→再追加や継続成長で「支払い済みの再生数」を再計上しないようにする。
-- 課金 = net = max(0, gross_billable_views - paid_views)。total_views は gross 表示のまま。

create table if not exists public.video_payout_ledger (
  platform    text not null,
  content_id  text not null,
  paid_views  bigint not null default 0,
  paid_amount numeric(14,2) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (platform, content_id)
);
alter table public.video_payout_ledger enable row level security;
-- 書き込みは SECURITY DEFINER 関数(mark_payout_paid)経由のみ。集計は service_role ビュー経由。

-- ───────── 課金ビューを net 化（gross_billable - paid_views） ─────────

create or replace view public.v_billable as
 select tv.id as tracked_video_id, tv.campaign_id, tv.linked_account_id, tv.platform, tv.content_id, tv.title,
    tv.last_views as attributable_views, tv.peak_views, tv.cap,
    greatest(0::bigint,
      (floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000)::bigint
      - coalesce(l.paid_views, 0::bigint)) as billable_views,
    tv.unit_price,
    round(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price, 0) as billable_amount,
    tv.status, tv.retired_reason, tv.anomaly_flag, tv.next_check_at, tv.last_checked_at,
    case
      when tv.anomaly_flag is not null and tv.status = 'active' then 'review'
      when tv.status = 'active' and tv.stall_count >= 1 then 'slowing'
      when tv.status = 'active' then 'tracking'
      when tv.retired_reason = 'cap' then 'completed'
      else 'retired'
    end as display_status,
    coalesce(l.paid_views, 0::bigint) as paid_views
 from public.tracked_videos tv
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id;

create or replace view public.v_account_dashboard as
 select la.id as linked_account_id, la.user_id, la.platform, la.handle, la.status as connection_status, la.is_new_account,
    count(tv.id) as total_videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    count(*) filter (where tv.status = 'retired') as retired_videos,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 group by la.id;

create or replace view public.v_user_totals as
 select la.user_id,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 group by la.user_id;

create or replace view public.v_user_platform as
 select la.user_id, la.platform,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric)), 0::numeric) as billable_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.linked_accounts la
 left join public.tracked_videos tv on tv.linked_account_id = la.id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 group by la.user_id, la.platform;

create or replace view public.v_campaign_creators as
 select tv.campaign_id, la.user_id as creator_id, au.email as creator_email, la.platform, la.handle,
    count(tv.id) as videos,
    count(*) filter (where tv.status = 'active') as active_videos,
    coalesce(sum(tv.last_views), 0::numeric) as total_views,
    coalesce(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric)), 0::numeric) as billable_views,
    coalesce(round(sum(greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000
      - coalesce(l.paid_views, 0)::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
 from public.tracked_videos tv
 join public.linked_accounts la on la.id = tv.linked_account_id
 left join public.app_users au on au.id = la.user_id
 left join public.video_payout_ledger l on l.platform = tv.platform and l.content_id = tv.content_id
 group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

-- ───────── 支払い確定: ユーザーの全動画の現在 gross billable を台帳に記録 ─────────
create or replace function public.mark_payout_paid(p_request_id uuid, p_fee numeric)
returns public.payout_requests
language plpgsql security definer set search_path = public as $$
declare v_req public.payout_requests; v_email text;
begin
  select au.email into v_email from public.app_users au where au.id = auth.uid();
  if not exists (select 1 from public.organizer_emails oe where lower(oe.email) = lower(coalesce(v_email,'__none__'))) then
    raise exception 'forbidden: organizer only';
  end if;

  select * into v_req from public.payout_requests where id = p_request_id;
  if v_req.id is null then raise exception 'payout request not found'; end if;

  -- このユーザーの全動画の「現在の gross billable 再生数/金額」を支払い済みとして記録（greatest で累積）。
  insert into public.video_payout_ledger (platform, content_id, paid_views, paid_amount)
  select tv.platform, tv.content_id,
         (floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000)::bigint,
         round(floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000 * tv.unit_price, 0)
  from public.tracked_videos tv
  join public.linked_accounts la on la.id = tv.linked_account_id
  where la.user_id = v_req.user_id
  on conflict (platform, content_id) do update
    set paid_views  = greatest(public.video_payout_ledger.paid_views, excluded.paid_views),
        paid_amount = greatest(public.video_payout_ledger.paid_amount, excluded.paid_amount),
        updated_at  = now();

  update public.payout_requests
     set status = 'paid', fee = coalesce(p_fee, fee), paid_at = now()
   where id = p_request_id
   returning * into v_req;

  return v_req;
end $$;
grant execute on function public.mark_payout_paid(uuid, numeric) to authenticated;
