-- 0007_profiles_billing.sql
-- (A) クリエイター プロフィール（内部管理ID / 氏名 / SNS / 銀行口座 / Discord）
-- (B) 課金を「1000再生ブロック単位」に変更（1000未満=¥0, 1890=¥100）

-- ───────── (A) プロフィール ─────────
create sequence if not exists public.internal_id_seq start 1;

create table if not exists public.profiles (
  user_id              uuid primary key references public.app_users(id) on delete cascade,
  internal_id          text unique,              -- ZG-0001
  name_kanji           text,                     -- 氏名（漢字）
  name_kana            text,                     -- 氏名（カナ）
  name_kana_half       text,                     -- 半角カナ名義（全銀フォーマット用）
  discord_username     text,                     -- Discord 連携（内部IDと紐付け）
  sns_youtube_url      text,
  sns_tiktok_url       text,
  sns_instagram_url    text,
  bank_code            text,                     -- 銀行コード
  branch_code          text,                     -- 支店コード
  account_type         text check (account_type in ('普通','当座')),
  account_number       text,
  account_holder_kana  text,                     -- 名義カナ（半角）
  onboarded            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- 内部管理ID 自動発番: ZG-0001
create or replace function public.set_internal_id()
returns trigger language plpgsql as $$
begin
  if new.internal_id is null then
    new.internal_id := 'ZG-' || lpad(nextval('public.internal_id_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_internal_id on public.profiles;
create trigger trg_profiles_internal_id before insert on public.profiles
  for each row execute function public.set_internal_id();
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
-- 本人は自分のプロフィールを読み書き
create policy profiles_self on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- オーガナイザーは全員のプロフィールを閲覧（一元管理）
create policy profiles_organizer_read on public.profiles
  for select using (public.is_organizer());

-- ───────── (B) 1000再生ブロック課金 ─────────
-- billable_views = floor(LEAST(views, cap) / 1000) * 1000（1000未満切り捨て=0）
-- billable_amount = billable_views * unit_price（unit_price=0.1 → 1000再生=¥100）

create or replace view public.v_billable as
select
  tv.id                                   as tracked_video_id,
  tv.campaign_id,
  tv.linked_account_id,
  tv.platform,
  tv.content_id,
  tv.title,
  tv.last_views                           as attributable_views,
  tv.peak_views,
  tv.cap,
  (floor(least(tv.last_views, tv.cap) / 1000.0) * 1000)::bigint as billable_views,
  tv.unit_price,
  round((floor(least(tv.last_views, tv.cap) / 1000.0) * 1000) * tv.unit_price, 0) as billable_amount,
  tv.status,
  tv.retired_reason,
  tv.anomaly_flag,
  tv.next_check_at,
  tv.last_checked_at,
  case
    when tv.anomaly_flag is not null and tv.status = 'active' then 'review'
    when tv.status = 'active' and tv.stall_count >= 1 then 'slowing'
    when tv.status = 'active'                          then 'tracking'
    when tv.retired_reason = 'cap'                     then 'completed'
    else 'retired'
  end as display_status
from public.tracked_videos tv;
alter view public.v_billable set (security_invoker = true);

create or replace view public.v_account_dashboard as
select
  la.id          as linked_account_id,
  la.user_id,
  la.platform,
  la.handle,
  la.status      as connection_status,
  la.is_new_account,
  count(tv.id)                                  as total_videos,
  count(*) filter (where tv.status = 'active')  as active_videos,
  count(*) filter (where tv.status = 'retired') as retired_videos,
  coalesce(round(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000 * tv.unit_price), 0), 0) as billable_amount
from public.linked_accounts la
left join public.tracked_videos tv on tv.linked_account_id = la.id
group by la.id;
alter view public.v_account_dashboard set (security_invoker = true);

create or replace view public.v_campaign_creators as
select
  tv.campaign_id,
  la.user_id                                   as creator_id,
  au.email                                     as creator_email,
  la.platform,
  la.handle,
  count(tv.id)                                 as videos,
  count(*) filter (where tv.status = 'active') as active_videos,
  coalesce(sum(tv.last_views), 0)              as total_views,
  coalesce(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000), 0) as billable_views,
  coalesce(round(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000 * tv.unit_price), 0), 0) as billable_amount
from public.tracked_videos tv
join public.linked_accounts la on la.id = tv.linked_account_id
left join public.app_users au on au.id = la.user_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;
alter view public.v_campaign_creators set (security_invoker = true);
