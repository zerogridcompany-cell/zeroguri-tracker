-- 0028: Discord「表示名」を必須情報として追加。
-- 既存の discord_username（ユーザー名）は温存しつつ、表示名を別カラムで持つ。
-- 全員が未入力（NULL）から始まるので、アプリ側のゲートで全員に一度入力させられる。
alter table public.profiles
  add column if not exists discord_display_name text;

comment on column public.profiles.discord_display_name is
  'Discord の表示名（ユーザー名ではなく、サーバー上の表示名）。登録時必須。';
