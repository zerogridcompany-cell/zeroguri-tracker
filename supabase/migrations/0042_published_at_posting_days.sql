-- 0042: 投稿日(published_at)を保存し、毎日投稿トラッキングの基盤を作る。
-- 既存行は投稿日が無いので created_at（システム追加日）でバックフィル。
alter table public.tracked_videos add column if not exists published_at timestamptz;
update public.tracked_videos set published_at = created_at where published_at is null;
create index if not exists idx_tracked_videos_published on public.tracked_videos (linked_account_id, published_at);

-- (ユーザー×案件×JST日付) ごとの投稿数。カレンダー/連続日数の元データ。
create or replace view public.v_user_posting_days as
select la.user_id, tv.campaign_id,
  ((tv.published_at at time zone 'Asia/Tokyo'))::date as posted_date,
  count(*) as posts
from public.tracked_videos tv
  join public.linked_accounts la on la.id = tv.linked_account_id
where tv.published_at is not null
group by la.user_id, tv.campaign_id, ((tv.published_at at time zone 'Asia/Tokyo'))::date;
