-- 0030: ペイアウト台帳（per動画）を正しく再導入し、課金を「差分（未払い分）」に。
-- ・台帳は (campaign_id, platform, content_id) で一意 → 動画を削除→再追加しても支払い済み分は残る。
-- ・支払い確定(mark_payout_paid)時に、そのユーザー×その案件の各動画の現在の課金再生数(gross)を
--   「支払い済み高水位 paid_views」として記録。
-- ・ユーザーに見える稼いだ額 = 未払いの差分のみ（gross − paid_views）。
-- ・予算進捗 v_campaign_progress は総額のまま（予算は支払い済みも消費するため）。

-- ── 台帳を作り直し（旧 0017 の名残データは破棄してクリーンスタート）──
drop table if exists public.video_payout_ledger cascade;

create table public.video_payout_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  platform text not null,
  content_id text not null,
  handle text,
  title text,
  paid_views bigint not null default 0,   -- 支払い済みの課金再生数（1000単位の高水位）
  paid_amount numeric not null default 0, -- 支払い済み額（参考・累計）
  last_payout_request_id uuid references public.payout_requests(id) on delete set null,
  last_paid_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, platform, content_id)
);

create index idx_vpl_campaign on public.video_payout_ledger (campaign_id);
create index idx_vpl_user on public.video_payout_ledger (user_id);

-- RLS: 既定で全拒否（読み書きは service_role の Edge Function / SECURITY DEFINER 関数経由のみ）。
-- 課金ビューはビュー所有者権限で台帳を読むため RLS の影響を受けない。
alter table public.video_payout_ledger enable row level security;

-- ── 課金ビューを net（未払い差分）に変更 ──
-- 1動画あたりの net 課金再生数 = max(0, floor(least(last_views,cap)/1000)*1000 − 台帳paid_views)

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
  end as display_status
from public.tracked_videos tv
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id;

create or replace view public.v_account_dashboard as
select la.id as linked_account_id, la.user_id, la.platform, la.handle,
  la.status as connection_status, la.is_new_account,
  count(tv.id) as total_videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  count(*) filter (where tv.status = 'retired'::text) as retired_videos,
  coalesce(round(sum(
    greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
      - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount,
  la.campaign_id
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.id;

create or replace view public.v_user_totals as
select la.user_id,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  coalesce(round(sum(
    greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
      - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
from public.linked_accounts la
  left join public.tracked_videos tv on tv.linked_account_id = la.id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by la.user_id;

create or replace view public.v_campaign_creators as
select tv.campaign_id, la.user_id as creator_id, au.email as creator_email,
  la.platform, la.handle,
  count(tv.id) as videos,
  count(*) filter (where tv.status = 'active'::text) as active_videos,
  coalesce(sum(tv.last_views), 0::numeric) as total_views,
  coalesce(sum(
    greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
      - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric)), 0::numeric) as billable_views,
  coalesce(round(sum(
    greatest(0::numeric,
      floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000::numeric
      - coalesce(l.paid_views, 0)::numeric)
    * coalesce(cp.cap_factor, 1::numeric) * tv.unit_price), 0), 0::numeric) as billable_amount
from public.tracked_videos tv
  join public.linked_accounts la on la.id = tv.linked_account_id
  left join public.app_users au on au.id = la.user_id
  left join public.video_payout_ledger l
    on l.campaign_id = tv.campaign_id and l.platform = tv.platform and l.content_id = tv.content_id
  left join public.v_campaign_progress cp on cp.campaign_id = tv.campaign_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;

-- ── mark_payout_paid: 支払い確定 + 台帳へ「支払い済み高水位」を記録 ──
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
             (floor(least(tv.last_views, tv.cap::bigint)::numeric / 1000.0) * 1000)::bigint as gross_bv
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
