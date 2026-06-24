-- 0046: 提出フローのセキュリティ/整合性ハードニング（レビュー指摘の修正）
--  (A) ig_type を NULL 許可（YouTube/TikTok 提出を可能に）
--  (B) app_users.email をクライアントから変更不可に（オーガナイザー昇格の防止）
--  (C) 提出 INSERT 時にファイル/投稿先アカウントをサーバ側で検証・確定（なりすまし/SSRF 防止）

-- (A) ig_type は Instagram 以外では null。デフォルト/下流コードは null を許容済み。
alter table public.video_submissions alter column ig_type drop not null;

-- (B) app_users.email は signup 時に definer トリガで auth.users から複製される値。
--     クライアント(authenticated/anon)からの email 変更を禁止し、認可の根拠を不変にする。
revoke update (email) on public.app_users from authenticated, anon;
-- 念のため WITH CHECK も付与（行の所有者付け替えを禁止）。
alter policy app_users_self_update on public.app_users
  using (auth.uid() = id) with check (auth.uid() = id);

-- (C) 提出 INSERT の検証付き force-pending トリガに置き換え。
--     storage_path / public_url を本人フォルダ配下に固定し、public_url はサーバ側で確定。
--     linked_account_id は本人の連携のみ許可し、platform / handle を連携元から確定（クライアント値は無視）。
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

  -- 提出ファイルは本人のフォルダ（<uid>/...）配下のみ
  if new.storage_path is null or new.storage_path not like new.user_id::text || '/%' then
    raise exception 'invalid storage_path';
  end if;
  -- public_url はクライアント値を信用せず storage_path から確定（外部URLによる SSRF/差し替えを排除）
  new.public_url := 'https://xapgynzijixztvrucppe.supabase.co/storage/v1/object/public/submissions/'
    || new.storage_path;

  -- 投稿先アカウントは本人の連携のみ。platform / handle は連携元から確定。
  if new.linked_account_id is not null then
    select user_id, platform, handle into v_user_id, v_platform, v_handle
    from public.linked_accounts where id = new.linked_account_id;
    if v_user_id is null or v_user_id <> new.user_id then
      raise exception 'linked_account not owned by user';
    end if;
    new.platform := v_platform;
    new.handle := v_handle;
  end if;

  return new;
end $$;
