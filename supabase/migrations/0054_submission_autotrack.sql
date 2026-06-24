-- 0054: 自動投稿された動画を自動でトラッキング登録するための土台（追加のみ・既存データは不変）。
--  buffer_post_id: Buffer の投稿ID（公開後に公開URLを引くため）
--  tracked_video_id: 自動作成した tracked_videos の id（= 登録済みフラグ。二重登録防止）
alter table public.video_submissions add column if not exists buffer_post_id text;
alter table public.video_submissions add column if not exists tracked_video_id uuid references public.tracked_videos(id) on delete set null;
