-- 0001_init_core.sql — 本体ユーザー & 連携アカウント
-- ZeroGuri Tracker / standalone Supabase

create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()

-- ───────── updated_at 自動更新トリガ ─────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────── 本体ユーザー（auth.users をミラー）─────────
-- 本体ログインは Supabase Auth（Google 主 / Apple 併置）。id = auth.users.id = creator_id。
create table public.app_users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_app_users_updated before update on public.app_users
  for each row execute function public.set_updated_at();

-- auth.users 作成時に app_users を自動生成
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── 連携アカウント（1ユーザー : N連携）─────────
create table public.linked_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.app_users(id) on delete cascade,
  platform            text not null check (platform in ('youtube','tiktok','instagram')),
  platform_user_id    text not null,                 -- channel_id / open_id / ig_user_id
  handle              text,                           -- @表示名
  account_created_at  timestamptz,                    -- 新規判定に使用
  follower_count      bigint,
  existing_post_count integer,                        -- 連携時点の投稿数（新規判定）
  is_new_account      boolean not null default false,
  access_token_enc    bytea,                          -- AES-GCM 暗号文。平文保存禁止
  refresh_token_enc   bytea,
  token_expires_at    timestamptz,
  scopes              text[],
  status              text not null default 'connected'
                        check (status in ('connected','revoked','error')),
  last_error          text,
  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (platform, platform_user_id)
);
create index idx_linked_accounts_user on public.linked_accounts(user_id);
create index idx_linked_accounts_status on public.linked_accounts(status);
-- トークン期限が近い connected アカウントだけを refresh-tokens が拾う（部分インデックス）
create index idx_linked_accounts_expiring on public.linked_accounts(token_expires_at)
  where status = 'connected';
create trigger trg_linked_accounts_updated before update on public.linked_accounts
  for each row execute function public.set_updated_at();

-- ───────── OAuth state（CSRF 対策。oauth-url が発行 → oauth-callback が照合）─────────
create table public.pending_oauth_states (
  state       text primary key,
  user_id     uuid not null references public.app_users(id) on delete cascade,
  platform    text not null check (platform in ('youtube','tiktok','instagram')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes'
);
create index idx_oauth_states_expiry on public.pending_oauth_states(expires_at);
alter table public.pending_oauth_states enable row level security;
-- service_role のみ操作（ポリシー無し = クライアントは触れない）。

-- ───────── RLS: 本人のみ参照可。Edge Functions は service_role でバイパス ─────────
alter table public.app_users      enable row level security;
alter table public.linked_accounts enable row level security;

create policy app_users_self on public.app_users
  for select using (auth.uid() = id);
create policy app_users_self_update on public.app_users
  for update using (auth.uid() = id);

create policy linked_self on public.linked_accounts
  for select using (auth.uid() = user_id);
-- INSERT/UPDATE/DELETE は Edge Functions（service_role）経由のみ。トークン列をクライアントに触らせない。
-- 0002_tracking.sql — 案件 / トラッキング対象動画 / 計測時系列
-- コスト最適化の核（active set 部分インデックス + claim 関数）を含む。

-- ───────── 案件（campaign）─────────
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.app_users(id) on delete cascade,
  title         text not null,
  description   text,
  cap_default   integer not null default 500000,   -- 案件既定の cap（動画ごとに上書き可）
  unit_price    numeric(12,4) not null default 0.1, -- ¥ / view（= ¥100 / 1,000再生）
  status        text not null default 'active'
                  check (status in ('draft','active','ended')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_campaigns_owner on public.campaigns(owner_id);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ───────── トラッキング対象動画（active set）─────────
create table public.tracked_videos (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  linked_account_id uuid not null references public.linked_accounts(id) on delete cascade,
  platform          text not null check (platform in ('youtube','tiktok','instagram')),
  content_id        text not null,                       -- 動画ID / shortcode
  title             text,
  url               text,
  cap               integer not null default 500000,     -- 案件/動画ごとに可変
  unit_price        numeric(12,4) not null default 0.1,
  baseline_views    bigint not null default 0,           -- 既存アカ連携時の初期値（新規アカ=0）
  last_views        bigint not null default 0,           -- attributable の前回値
  status            text not null default 'active'
                      check (status in ('active','retired')),
  retired_reason    text check (retired_reason in ('cap','stalled','expired','revoked')),
  stall_count       smallint not null default 0,
  error_count       smallint not null default 0,
  check_interval    interval not null default interval '1 day',
  next_check_at     timestamptz not null default now(),
  last_checked_at   timestamptz,
  retired_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (platform, content_id)
);

-- ★ 生きている動画だけを索引に載せる部分インデックス（コスト最適化の核）。
--   retired は索引に存在しないため、何百万本 retire してもスキャンは生きてる分だけ。
create index idx_due on public.tracked_videos (next_check_at) where status = 'active';
create index idx_tracked_campaign on public.tracked_videos(campaign_id);
create index idx_tracked_account  on public.tracked_videos(linked_account_id);
create trigger trg_tracked_updated before update on public.tracked_videos
  for each row execute function public.set_updated_at();

-- 同一動画が複数案件に紐づくエッジケース（請求は各 link の cap/unit_price で按分管理）
create table public.campaign_video_links (
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  tracked_video_id uuid not null references public.tracked_videos(id) on delete cascade,
  cap              integer,
  unit_price       numeric(12,4),
  created_at       timestamptz not null default now(),
  primary key (campaign_id, tracked_video_id)
);

-- ───────── 計測時系列（差分グラフ・監査用）─────────
create table public.view_snapshots (
  tracked_video_id uuid not null references public.tracked_videos(id) on delete cascade,
  captured_at      timestamptz not null default now(),
  views            bigint not null,                    -- attributable（baseline 差し引き後）
  raw_views        bigint,                             -- provider が返した生値（監査用）
  primary key (tracked_video_id, captured_at)
);
create index idx_snapshots_time on public.view_snapshots(captured_at);

-- ───────── due な動画を安全に claim（FOR UPDATE SKIP LOCKED）─────────
-- 複数 tick が同時に走っても二重取得しない。next_check_at を先送りして in-flight を可視化。
create or replace function public.claim_due_tracked_videos(p_limit int default 500)
returns setof public.tracked_videos
language plpgsql as $$
begin
  return query
  with due as (
    select tv.id
    from public.tracked_videos tv
    where tv.status = 'active' and tv.next_check_at <= now()
    order by tv.next_check_at
    limit p_limit
    for update skip locked
  )
  update public.tracked_videos tv
     set next_check_at = now() + interval '15 minutes'   -- in-flight ロック（成功時に正規 interval で上書き）
  from due
  where tv.id = due.id
  returning tv.*;
end $$;

-- ───────── RLS ─────────
alter table public.campaigns            enable row level security;
alter table public.tracked_videos       enable row level security;
alter table public.view_snapshots       enable row level security;
alter table public.campaign_video_links enable row level security;

create policy campaigns_owner on public.campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy tracked_owner on public.tracked_videos
  for select using (
    exists (select 1 from public.campaigns c where c.id = tracked_videos.campaign_id and c.owner_id = auth.uid())
  );

create policy snapshots_owner on public.view_snapshots
  for select using (
    exists (
      select 1 from public.tracked_videos tv
      join public.campaigns c on c.id = tv.campaign_id
      where tv.id = view_snapshots.tracked_video_id and c.owner_id = auth.uid()
    )
  );

create policy links_owner on public.campaign_video_links
  for select using (
    exists (select 1 from public.campaigns c where c.id = campaign_video_links.campaign_id and c.owner_id = auth.uid())
  );
-- 0003_audit_billing.sql — トークンアクセス監査 + 請求/集計ビュー

-- ───────── トークンアクセス監査（IPO 監査対応）─────────
-- 「誰が・いつ・どのトークンを復号/参照したか」を記録。
create table public.token_access_audit (
  id                uuid primary key default gen_random_uuid(),
  linked_account_id uuid references public.linked_accounts(id) on delete set null,
  accessor          text not null,          -- function 名 or service identity
  action            text not null,          -- 'decrypt' | 'refresh' | 'revoke' | 'read'
  context           jsonb,
  accessed_at       timestamptz not null default now()
);
create index idx_audit_account on public.token_access_audit(linked_account_id);
create index idx_audit_time    on public.token_access_audit(accessed_at);
alter table public.token_access_audit enable row level security;
-- 監査ログはクライアントから読めない（service_role のみ）。ポリシー無し = deny all。

-- ───────── 請求: 動画別 ─────────
-- billable_views = LEAST(attributable, cap)。cap 超過分は請求に無関係。
create or replace view public.v_billable as
select
  tv.id                                   as tracked_video_id,
  tv.campaign_id,
  tv.linked_account_id,
  tv.platform,
  tv.content_id,
  tv.title,
  tv.last_views                           as attributable_views,
  tv.cap,
  least(tv.last_views, tv.cap)            as billable_views,
  tv.unit_price,
  round(least(tv.last_views, tv.cap) * tv.unit_price, 2) as billable_amount,
  tv.status,
  tv.retired_reason,
  tv.next_check_at,
  tv.last_checked_at,
  -- ダッシュボード用ステータス: 計測中 / 完了(cap) / 鈍化 / 引退
  case
    when tv.status = 'active' and tv.stall_count >= 1 then 'slowing'
    when tv.status = 'active'                          then 'tracking'
    when tv.retired_reason = 'cap'                     then 'completed'
    else 'retired'
  end as display_status
from public.tracked_videos tv;

-- ───────── 請求: 案件別サマリー ─────────
create or replace view public.v_campaign_summary as
select
  c.id              as campaign_id,
  c.owner_id,
  c.title,
  c.status,
  count(tv.id)                                            as total_videos,
  count(*) filter (where tv.status = 'active')            as active_videos,
  count(*) filter (where tv.status = 'retired')           as retired_videos,
  coalesce(sum(tv.last_views), 0)                         as total_attributable_views,
  coalesce(sum(least(tv.last_views, tv.cap)), 0)          as total_billable_views,
  coalesce(round(sum(least(tv.last_views, tv.cap) * tv.unit_price), 2), 0) as total_billable_amount
from public.campaigns c
left join public.tracked_videos tv on tv.campaign_id = c.id
group by c.id;

-- ───────── 連携別ダッシュボード集計（active=今コストがかかってる本数）─────────
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
  coalesce(round(sum(least(tv.last_views, tv.cap) * tv.unit_price), 2), 0) as billable_amount
from public.linked_accounts la
left join public.tracked_videos tv on tv.linked_account_id = la.id
group by la.id;

-- ビューは barrier security のため security_invoker（呼び出し元の RLS を適用）
alter view public.v_billable          set (security_invoker = true);
alter view public.v_campaign_summary  set (security_invoker = true);
alter view public.v_account_dashboard set (security_invoker = true);
-- 0004_cron.sql — pg_cron スケジューラ
-- tracking-tick（10分毎）と refresh-tokens（1時間毎）を Edge Function として叩く。
-- service_role_key は Supabase Vault に格納し、平文で残さない。

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ── 設定の置き場 ──
-- 本番では Vault を使う:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- ローカルでは下の helper が app.settings.* GUC を読む。db reset 後に値を設定:
--   alter database postgres set app.settings.functions_url = 'http://kong:8000/functions/v1';
--   alter database postgres set app.settings.service_role_key = '<key>';

create or replace function public.invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  key      text := current_setting('app.settings.service_role_key', true);
  req_id   bigint;
begin
  if base_url is null then
    raise notice 'app.settings.functions_url not set; skipping invoke of %', fn;
    return null;
  end if;
  select net.http_post(
    url     := base_url || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || coalesce(key, '')
               ),
    body    := body
  ) into req_id;
  return req_id;
end $$;

-- ── スケジュール ──
-- 既存ジョブがあれば貼り直し（冪等）
select cron.unschedule('zeroguri-tracking-tick')  where exists (select 1 from cron.job where jobname = 'zeroguri-tracking-tick');
select cron.unschedule('zeroguri-refresh-tokens') where exists (select 1 from cron.job where jobname = 'zeroguri-refresh-tokens');

-- 生きてる動画の計測: 10分毎（実コールは active set の due 分のみ）
select cron.schedule(
  'zeroguri-tracking-tick',
  '*/10 * * * *',
  $$ select public.invoke_edge_function('tracking-tick', '{}'::jsonb); $$
);

-- TikTok のサイレント失効監視: 1時間毎
select cron.schedule(
  'zeroguri-refresh-tokens',
  '0 * * * *',
  $$ select public.invoke_edge_function('refresh-tokens', '{}'::jsonb); $$
);
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
