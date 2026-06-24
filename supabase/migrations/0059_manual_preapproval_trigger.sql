-- 0059: 手動を「投稿前承認」に作り直し。手動も動画ファイルをアップロードして提出するため、
--  0057 の「手動は storage_path をスキップ」分岐を撤回し、提出は常に storage_path 必須＋public_url確定に戻す。
--  （手動の content_id/url は提出時には無く、承認後のURL登録時に埋める。）
create or replace function public.video_submissions_force_pending() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_platform text;
  v_handle text;
begin
  new.status := 'pending';
  new.buffer_result := null;
  new.drive_folder := null;
  new.reviewed_by := null;
  new.reviewed_at := null;

  -- 提出ファイルは本人のフォルダ（<uid>/...）配下のみ。'..' は拒否。
  if new.storage_path is null
     or new.storage_path not like new.user_id::text || '/%'
     or position('..' in new.storage_path) > 0 then
    raise exception 'invalid storage_path';
  end if;
  -- public_url はクライアント値を信用せず storage_path から確定（外部URLによる SSRF/差し替えを排除）
  new.public_url := 'https://xapgynzijixztvrucppe.supabase.co/storage/v1/object/public/submissions/'
    || new.storage_path;

  -- 投稿先アカウントは必須かつ本人の連携のみ。platform / handle は連携元から確定。
  if new.linked_account_id is null then
    raise exception 'linked_account_id required';
  end if;
  select user_id, platform, handle into v_user_id, v_platform, v_handle
  from public.linked_accounts where id = new.linked_account_id;
  if v_user_id is null or v_user_id <> new.user_id then
    raise exception 'linked_account not owned by user';
  end if;
  new.platform := v_platform;
  new.handle := v_handle;

  return new;
end $$;
