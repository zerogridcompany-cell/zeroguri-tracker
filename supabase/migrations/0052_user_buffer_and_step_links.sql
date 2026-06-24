-- 0052: ユーザーごとの Buffer トークン（本人が自分のBufferに連携）＋ 講義ステップのリンクボタン。
-- 各クリエイターが自分のBufferアクセストークンをサイトで連携 → 自分のアカウントへ予約投稿。
create table if not exists public.user_buffer_connections (
  user_id    uuid primary key references public.app_users(id) on delete cascade,
  token_enc  bytea not null,           -- AES-GCM 暗号文（平文保存禁止）
  org_id     text,                     -- そのユーザーの Buffer organization id
  updated_at timestamptz not null default now()
);
alter table public.user_buffer_connections enable row level security; -- service_role / 関数経由のみ（ポリシー無し＝クライアント読取不可）

-- 講義ステップに「リンクボタン」を追加（実際の接続URL等を貼れるように）
alter table public.lecture_steps add column if not exists link_url text;
alter table public.lecture_steps add column if not exists link_label text;
