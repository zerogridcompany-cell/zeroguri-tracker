-- 0006_organizer.sql — オーガナイザー（案件主催）ロール + 参加モデル
-- 指定メールのユーザー = オーガナイザー。案件を作成し、参加クリエイターの再生数/報酬を見る。
-- クリエイターは active な案件に自分の動画を追加して「参加」する。

-- ───────── オーガナイザー allowlist ─────────
create table if not exists public.organizer_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
insert into public.organizer_emails (email) values ('seiyo.miyazono@infozerogrid.com')
  on conflict (email) do nothing;
alter table public.organizer_emails enable row level security;
-- ポリシー無し = クライアント直読み不可（is_organizer() 経由でのみ判定）。

-- ログイン中ユーザーがオーガナイザーか（メール一致）
create or replace function public.is_organizer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.organizer_emails oe
    join auth.users u on lower(u.email) = lower(oe.email)
    where u.id = auth.uid()
  );
$$;
grant execute on function public.is_organizer() to authenticated, anon;

-- ───────── 参加モデルの RLS ─────────
-- 案件: 自分のもの + active な案件は誰でも閲覧（参加先として選べる）
drop policy if exists campaigns_owner on public.campaigns;
create policy campaigns_owner on public.campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy campaigns_read_active on public.campaigns
  for select using (status = 'active' or owner_id = auth.uid());

-- tracked_videos: 自分の連携アカウント由来 OR 自分が主催の案件 を閲覧可
drop policy if exists tracked_owner on public.tracked_videos;
create policy tracked_creator_or_owner on public.tracked_videos
  for select using (
    exists (
      select 1 from public.linked_accounts la
      where la.id = tracked_videos.linked_account_id and la.user_id = auth.uid()
    )
    or exists (
      select 1 from public.campaigns c
      where c.id = tracked_videos.campaign_id and c.owner_id = auth.uid()
    )
  );

-- ───────── オーガナイザー集計ビュー: 案件 × 参加クリエイター ─────────
create or replace view public.v_campaign_creators as
select
  tv.campaign_id,
  la.user_id                                   as creator_id,
  au.email                                     as creator_email,
  la.platform,
  la.handle,
  count(tv.id)                                 as videos,
  count(*) filter (where tv.status = 'active') as active_videos,
  coalesce(sum(tv.last_views), 0)              as total_views,
  coalesce(sum(least(tv.last_views, tv.cap)), 0) as billable_views,
  coalesce(round(sum(least(tv.last_views, tv.cap) * tv.unit_price), 2), 0) as billable_amount
from public.tracked_videos tv
join public.linked_accounts la on la.id = tv.linked_account_id
left join public.app_users au on au.id = la.user_id
group by tv.campaign_id, la.user_id, au.email, la.platform, la.handle;
alter view public.v_campaign_creators set (security_invoker = true);
