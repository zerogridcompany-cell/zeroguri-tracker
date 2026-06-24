-- 0045: 提出に投稿先アカウント・却下理由・既読フラグを追加 ＋ 承認/却下の監査ログ。
alter table public.video_submissions
  add column if not exists linked_account_id uuid references public.linked_accounts(id) on delete set null,
  add column if not exists platform text,
  add column if not exists handle text,
  add column if not exists reject_reason text,
  add column if not exists seen_by_user boolean not null default true;

-- 承認/却下の履歴ログ
create table if not exists public.submission_audit_log (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.video_submissions(id) on delete cascade,
  action text not null,           -- 'approved' | 'rejected'
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_submission_audit_sub on public.submission_audit_log (submission_id, created_at desc);
alter table public.submission_audit_log enable row level security; -- service_role 関数経由のみ

-- 却下されたら本人未読に（確実にポップアップ表示するため）
