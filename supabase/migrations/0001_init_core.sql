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
