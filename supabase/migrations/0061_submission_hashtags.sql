-- 0061: 自動（Buffer投稿）提出にハッシュタグ欄。投稿時に本文へ付与する。手動提出では使わない。
alter table public.video_submissions add column if not exists hashtags text;
