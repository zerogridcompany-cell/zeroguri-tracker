-- 0060: 複数プラットフォーム同時提出。1回の提出で複数アカウント(プラットフォーム)に提出し、
--  group_id でまとめて「1回承認で全部」処理できるようにする。
alter table public.video_submissions add column if not exists group_id uuid;
create index if not exists idx_submissions_group on public.video_submissions (group_id) where group_id is not null;
