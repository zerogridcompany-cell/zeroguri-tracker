-- 0049: 投稿先（各アカウントの Buffer チャンネル）をアプリ側に保持し、連携アカウントと紐付ける。
--  予約投稿は「提出の連携アカウント → その Buffer チャンネル」へ飛ばす（各ユーザー自身のアカウントへ投稿）。
alter table public.linked_accounts add column if not exists buffer_channel_id text;

create table if not exists public.buffer_channels (
  id              text primary key,            -- Buffer channel id
  organization_id text,
  service         text,                        -- instagram / youtube / tiktok ...
  service_id      text,
  name            text,                        -- 表示名（ハンドルのことが多い）
  is_disconnected boolean not null default false,
  updated_at      timestamptz not null default now()
);
alter table public.buffer_channels enable row level security; -- service_role / 関数経由のみ
