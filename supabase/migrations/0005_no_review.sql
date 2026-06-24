-- 0005_no_review.sql — 無審査ルート対応（challenge 所有確認 + billing-integrity）
-- 連携の認証モデル: youtube/instagram = challenge（bio/概要欄コード）, tiktok = oauth（Login Kit Sandbox）。

-- ───────── 連携アカウント: 所有確認メソッド ─────────
alter table public.linked_accounts
  add column if not exists ownership_method     text
    check (ownership_method in ('challenge','oauth')),
  add column if not exists ownership_verified_at timestamptz;

-- ───────── トラッキング動画: billing-integrity ─────────
-- peak_views: これまでの attributable 最大値（再生数減少=スパム除去/クローバック検知の基準）。
-- anomaly_flag: 'drop'（再生数が有意に減少）/ 'spike'（1tickで非現実的に急増=viewbot 疑い）。
alter table public.tracked_videos
  add column if not exists peak_views   bigint not null default 0,
  add column if not exists anomaly_flag text
    check (anomaly_flag in ('drop','spike'));

-- ───────── チャレンジコード（所有確認: YT/IG）─────────
create table if not exists public.pending_link_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users(id) on delete cascade,
  platform    text not null check (platform in ('youtube','instagram')),
  identifier  text not null,                 -- YT: @handle or channelId / IG: username
  nonce       text not null,                 -- bio/概要欄に貼らせる一度きりのコード
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 minutes',
  unique (user_id, platform, identifier)
);
create index if not exists idx_link_challenges_expiry on public.pending_link_challenges(expires_at);
alter table public.pending_link_challenges enable row level security;
create policy link_challenge_self on public.pending_link_challenges
  for select using (auth.uid() = user_id);
-- INSERT/DELETE は Edge Functions（service_role）経由のみ。

-- ───────── 請求ビューを anomaly_flag 付きで貼り直し ─────────
-- 列順を変える（peak_views/anomaly_flag を追加）ため CREATE OR REPLACE ではなく DROP+CREATE。
drop view if exists public.v_billable;
create view public.v_billable as
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
  least(tv.last_views, tv.cap)            as billable_views,
  tv.unit_price,
  round(least(tv.last_views, tv.cap) * tv.unit_price, 2) as billable_amount,
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
