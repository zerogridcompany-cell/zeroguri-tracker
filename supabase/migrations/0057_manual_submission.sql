-- 0057: 手動投稿（投稿済みURLの提出）も承認フローに乗せる。
--  従来「手動 = register-tracked-video で即トラッキング（承認なし）」だったのを、
--  「手動 = video_submissions に提出 → 主催者が承認 → トラッキング登録」に変更。
--  自動（アップロード→Buffer）と同じ承認ページに並ぶ。

-- 提出タイプと、手動（投稿済み）用のフィールド
alter table public.video_submissions add column if not exists submission_type text not null default 'auto'; -- 'auto' | 'manual'
alter table public.video_submissions add column if not exists content_id text;     -- 手動: 投稿済み動画ID（正規化済み）
alter table public.video_submissions add column if not exists url text;             -- 手動: 投稿の正規URL
alter table public.video_submissions add column if not exists title text;           -- 手動: 動画タイトル（任意）
alter table public.video_submissions add column if not exists published_at timestamptz; -- 手動: 検証済み投稿日時

-- 手動はアップロードファイルが無いので storage_path / public_url を NULL 許容に
alter table public.video_submissions alter column storage_path drop not null;
alter table public.video_submissions alter column public_url drop not null;

-- 提出の検証トリガを type で分岐（自動=従来どおり厳格、手動=投稿済みURLを許容）
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

  if coalesce(new.submission_type, 'auto') = 'manual' then
    -- 手動（投稿済み）: ファイルは無い。投稿済み動画IDが必須。public_url は投稿URLをそのまま使う。
    if new.content_id is null or length(trim(new.content_id)) = 0 then
      raise exception 'content_id required for manual submission';
    end if;
  else
    -- 自動（アップロード）: 本人フォルダ配下のみ。'..' 拒否。public_url は storage_path から確定（SSRF/差し替え排除）。
    if new.storage_path is null
       or new.storage_path not like new.user_id::text || '/%'
       or position('..' in new.storage_path) > 0 then
      raise exception 'invalid storage_path';
    end if;
    new.public_url := 'https://xapgynzijixztvrucppe.supabase.co/storage/v1/object/public/submissions/'
      || new.storage_path;
  end if;

  -- 投稿先アカウントは必須かつ本人の連携のみ（両モード共通の なりすまし対策）。
  -- platform / handle は連携元から確定（クライアント値は無視）。
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
