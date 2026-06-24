-- 0048: 提出は必ず本人の連携アカウントを投稿先に持つことを必須化（0046 の (b) なりすまし穴を封鎖）。
--  - linked_account_id を NOT NULL 必須に（trigger 内で検証）。null を許すと platform/handle 上書きが
--    スキップされ、クライアント指定の偽 platform/handle が保存できてしまうため。
--  - storage_path の '..'（パストラバーサル）も拒否（0046 (d) の残課題）。
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

  -- 投稿先アカウントは必須かつ本人の連携のみ。platform / handle は連携元から確定（クライアント値は無視）。
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
