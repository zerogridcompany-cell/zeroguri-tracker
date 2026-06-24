-- 0012_payouts.sql — ペイアウト（振込）リクエスト
-- ユーザーが引き出しリクエスト → オーガナイザーが振込（手数料込み）→ 振込済みに。

create table if not exists public.payout_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.app_users(id) on delete cascade,
  amount        numeric(12,2) not null default 0,   -- 振込額（リクエスト時の確定報酬）
  fee           numeric(12,2) not null default 330,  -- 手数料（オーガナイザーが編集可）
  status        text not null default 'pending' check (status in ('pending','paid','rejected')),
  note          text,
  requested_at  timestamptz not null default now(),
  paid_at       timestamptz
);
create index if not exists idx_payout_status on public.payout_requests(status);
create index if not exists idx_payout_user on public.payout_requests(user_id);

alter table public.payout_requests enable row level security;
-- 本人: 自分のリクエストを作成・閲覧
create policy payout_select_self on public.payout_requests
  for select using (auth.uid() = user_id);
create policy payout_insert_self on public.payout_requests
  for insert with check (auth.uid() = user_id);
-- オーガナイザー: 全件 閲覧・更新（振込済み化・手数料設定）
create policy payout_org_select on public.payout_requests
  for select using (public.is_organizer());
create policy payout_org_update on public.payout_requests
  for update using (public.is_organizer()) with check (public.is_organizer());
