-- 0008_name_analytics.sql
-- (A) 氏名を 姓/名 × 漢字/カナ の4分割
-- (B) 分析ビュー: ユーザー×プラットフォーム / ユーザー合計（オーガナイザー分析・ランキング用）

-- ───────── (A) 氏名4分割 ─────────
alter table public.profiles
  add column if not exists last_name_kanji  text,   -- 姓（漢字）
  add column if not exists first_name_kanji text,   -- 名（漢字）
  add column if not exists last_name_kana   text,   -- 姓（カナ）
  add column if not exists first_name_kana  text;   -- 名（カナ）

-- ───────── (B) 分析ビュー ─────────
-- ユーザー × プラットフォーム別の集計
create or replace view public.v_user_platform as
select
  la.user_id,
  la.platform,
  count(tv.id)                                  as videos,
  count(*) filter (where tv.status = 'active')  as active_videos,
  coalesce(sum(tv.last_views), 0)               as total_views,
  coalesce(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000), 0) as billable_views,
  coalesce(round(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000 * tv.unit_price), 0), 0) as billable_amount
from public.linked_accounts la
left join public.tracked_videos tv on tv.linked_account_id = la.id
group by la.user_id, la.platform;
alter view public.v_user_platform set (security_invoker = true);

-- ユーザー合計（ランキング・一覧用）
create or replace view public.v_user_totals as
select
  la.user_id,
  count(tv.id)                                  as videos,
  count(*) filter (where tv.status = 'active')  as active_videos,
  coalesce(sum(tv.last_views), 0)               as total_views,
  coalesce(round(sum(floor(least(tv.last_views, tv.cap) / 1000.0) * 1000 * tv.unit_price), 0), 0) as billable_amount
from public.linked_accounts la
left join public.tracked_videos tv on tv.linked_account_id = la.id
group by la.user_id;
alter view public.v_user_totals set (security_invoker = true);
