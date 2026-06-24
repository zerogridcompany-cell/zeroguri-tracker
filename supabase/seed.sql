-- seed.sql — サンドボックス用デモデータ（実 API クレデンシャル不要で E2E を確認）
-- db reset 時に migrations の後に適用される。

-- ───────── デモ本体ユーザー ─────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'demo@zeroguri.app',
  extensions.crypt('password', extensions.gen_salt('bf')),
  now(), now() - interval '40 days', now(),
  '{"provider":"google","providers":["google"]}',
  '{"name":"Demo Creator","avatar_url":null}',
  false
) on conflict (id) do nothing;

-- handle_new_user トリガが app_users を作るが、念のため upsert
insert into public.app_users (id, email, display_name)
values ('11111111-1111-1111-1111-111111111111', 'demo@zeroguri.app', 'Demo Creator')
on conflict (id) do nothing;

-- ───────── 連携アカウント（トークンは sandbox なので NULL）─────────
insert into public.linked_accounts
  (id, user_id, platform, platform_user_id, handle, account_created_at, follower_count, existing_post_count, is_new_account, status, connected_at)
values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','youtube',
     'UC_demo_channel_001','@demo_yt', now() - interval '20 days', 1200, 0, true, 'connected', now() - interval '18 days'),
  ('a2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','tiktok',
     'open_id_demo_tt_001','@demo_tt', now() - interval '400 days', 53000, 87, false, 'connected', now() - interval '15 days'),
  ('a3333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','instagram',
     'ig_user_demo_001','@demo_ig', now() - interval '10 days', 800, 0, true, 'connected', now() - interval '9 days')
on conflict (platform, platform_user_id) do nothing;

-- ───────── 案件 ─────────
insert into public.campaigns (id, owner_id, title, description, cap_default, unit_price, status, starts_at)
values
  ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
   '夏のドリンクPR 2026', '新作ドリンクの紹介動画', 500000, 0.1, 'active', now() - interval '14 days')
on conflict (id) do nothing;

-- ───────── トラッキング対象動画（cost story を表現）─────────
insert into public.tracked_videos
  (id, campaign_id, linked_account_id, platform, content_id, title, url, cap, unit_price,
   baseline_views, last_views, status, retired_reason, stall_count, check_interval, next_check_at, last_checked_at, created_at)
values
  -- 伸び盛り（毎日チェック）
  ('d1111111-1111-1111-1111-111111111111','c1111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
   'youtube','dQw4w9WgXcQ','新作ドリンク飲んでみた','https://youtube.com/watch?v=dQw4w9WgXcQ',
   500000, 0.1, 0, 320000, 'active', null, 0, interval '1 day', now() + interval '12 hours', now() - interval '12 hours', now() - interval '10 days'),
  -- cap 到達で完了
  ('d2222222-2222-2222-2222-222222222222','c1111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
   'youtube','9bZkp7q19f0','ドリンク開封ショート','https://youtube.com/shorts/9bZkp7q19f0',
   500000, 0.1, 0, 500000, 'retired', 'cap', 0, interval '7 days', now() + interval '7 days', now() - interval '2 days', now() - interval '12 days'),
  -- 鈍化（既存アカ baseline あり、3日間隔、stall=1）
  ('d3333333-3333-3333-3333-333333333333','c1111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222',
   'tiktok','7300000000000000001','夏ドリンクTikTok','https://tiktok.com/@demo_tt/video/7300000000000000001',
   300000, 0.1, 8000, 142000, 'active', null, 1, interval '3 days', now() + interval '2 days', now() - interval '1 day', now() - interval '11 days'),
  -- 完全停止で引退
  ('d4444444-4444-4444-4444-444444444444','c1111111-1111-1111-1111-111111111111','a3333333-3333-3333-3333-333333333333',
   'instagram','C9aBcDeFgHi','夏ドリンクReels','https://instagram.com/reel/C9aBcDeFgHi',
   500000, 0.1, 0, 12000, 'retired', 'stalled', 2, interval '7 days', now() + interval '7 days', now() - interval '3 days', now() - interval '9 days')
on conflict (platform, content_id) do nothing;

-- ───────── 計測時系列（伸び盛り動画の成長カーブ）─────────
insert into public.view_snapshots (tracked_video_id, captured_at, views, raw_views) values
  ('d1111111-1111-1111-1111-111111111111', now() - interval '9 days', 18000, 18000),
  ('d1111111-1111-1111-1111-111111111111', now() - interval '7 days', 65000, 65000),
  ('d1111111-1111-1111-1111-111111111111', now() - interval '5 days', 140000, 140000),
  ('d1111111-1111-1111-1111-111111111111', now() - interval '3 days', 235000, 235000),
  ('d1111111-1111-1111-1111-111111111111', now() - interval '1 day', 290000, 290000),
  ('d1111111-1111-1111-1111-111111111111', now() - interval '12 hours', 320000, 320000)
on conflict do nothing;
