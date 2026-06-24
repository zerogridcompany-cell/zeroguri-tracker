-- 0053: 講義に解説動画URL（Loom等を埋め込み）。
alter table public.lectures add column if not exists video_url text;
