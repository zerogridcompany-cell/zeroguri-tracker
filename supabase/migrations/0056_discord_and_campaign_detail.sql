-- 0056: Discord通知（提出→通知、承認→リプライ）＋ 案件詳細のカスタマイズ項目。

-- 提出に Discord メッセージID（承認時にこのメッセージへリプライするため）
alter table public.video_submissions add column if not exists discord_message_id text;

-- 案件詳細: 画像・素材(YouTube)リンク・自由なリンク集（説明文 description は既存）
alter table public.campaigns add column if not exists image_url text;
alter table public.campaigns add column if not exists material_url text;   -- 素材元（YouTube等）
alter table public.campaigns add column if not exists links jsonb not null default '[]'::jsonb; -- [{label,url}]

-- 提出されたら Discord に通知（AFTER INSERT。invoke_edge_function 経由で非同期）
create or replace function public.notify_discord_submitted() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.invoke_edge_function('discord-notify', jsonb_build_object('submission_id', new.id, 'event', 'submitted'));
  return new;
end $$;
drop trigger if exists trg_video_submissions_discord on public.video_submissions;
create trigger trg_video_submissions_discord
  after insert on public.video_submissions
  for each row execute function public.notify_discord_submitted();
