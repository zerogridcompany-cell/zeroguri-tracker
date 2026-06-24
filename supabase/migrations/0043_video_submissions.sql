-- 0043: 動画提出→承認→Buffer予約 の基盤。
-- 提出動画は公開Storageバケット submissions に保存（BufferがURL取得＋オーガナイザーがプレビュー）。

-- 公開バケット
insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', true)
on conflict (id) do update set public = true;

-- 認証ユーザーは自分のフォルダ(<uid>/...)にアップロードできる
drop policy if exists "submissions_upload_own" on storage.objects;
create policy "submissions_upload_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "submissions_read" on storage.objects;
create policy "submissions_read" on storage.objects
  for select using (bucket_id = 'submissions');

-- 提出レコード
create table if not exists public.video_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  filename text,
  media_type text not null default 'video',   -- 'video' | 'image'
  ig_type text not null default 'reel',        -- 'post' | 'reel' | 'story'
  caption text,
  scheduled_at timestamptz,
  status text not null default 'pending',      -- pending | approved | rejected
  buffer_result text,
  drive_folder text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_submissions_status on public.video_submissions (status, created_at desc);
create index if not exists idx_submissions_user on public.video_submissions (user_id);

alter table public.video_submissions enable row level security;
-- 本人は自分の提出を作成・閲覧できる（オーガナイザー操作は service_role 関数経由）
drop policy if exists submissions_insert_own on public.video_submissions;
create policy submissions_insert_own on public.video_submissions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists submissions_select_own on public.video_submissions;
create policy submissions_select_own on public.video_submissions
  for select using (auth.uid() = user_id);
