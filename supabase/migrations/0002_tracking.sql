-- 0002_tracking.sql — 案件 / トラッキング対象動画 / 計測時系列
-- コスト最適化の核（active set 部分インデックス + claim 関数）を含む。

-- ───────── 案件（campaign）─────────
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.app_users(id) on delete cascade,
  title         text not null,
  description   text,
  cap_default   integer not null default 500000,   -- 案件既定の cap（動画ごとに上書き可）
  unit_price    numeric(12,4) not null default 0.1, -- ¥ / view（= ¥100 / 1,000再生）
  status        text not null default 'active'
                  check (status in ('draft','active','ended')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_campaigns_owner on public.campaigns(owner_id);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ───────── トラッキング対象動画（active set）─────────
create table public.tracked_videos (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  linked_account_id uuid not null references public.linked_accounts(id) on delete cascade,
  platform          text not null check (platform in ('youtube','tiktok','instagram')),
  content_id        text not null,                       -- 動画ID / shortcode
  title             text,
  url               text,
  cap               integer not null default 500000,     -- 案件/動画ごとに可変
  unit_price        numeric(12,4) not null default 0.1,
  baseline_views    bigint not null default 0,           -- 既存アカ連携時の初期値（新規アカ=0）
  last_views        bigint not null default 0,           -- attributable の前回値
  status            text not null default 'active'
                      check (status in ('active','retired')),
  retired_reason    text check (retired_reason in ('cap','stalled','expired','revoked')),
  stall_count       smallint not null default 0,
  error_count       smallint not null default 0,
  check_interval    interval not null default interval '1 day',
  next_check_at     timestamptz not null default now(),
  last_checked_at   timestamptz,
  retired_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (platform, content_id)
);

-- ★ 生きている動画だけを索引に載せる部分インデックス（コスト最適化の核）。
--   retired は索引に存在しないため、何百万本 retire してもスキャンは生きてる分だけ。
create index idx_due on public.tracked_videos (next_check_at) where status = 'active';
create index idx_tracked_campaign on public.tracked_videos(campaign_id);
create index idx_tracked_account  on public.tracked_videos(linked_account_id);
create trigger trg_tracked_updated before update on public.tracked_videos
  for each row execute function public.set_updated_at();

-- 同一動画が複数案件に紐づくエッジケース（請求は各 link の cap/unit_price で按分管理）
create table public.campaign_video_links (
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  tracked_video_id uuid not null references public.tracked_videos(id) on delete cascade,
  cap              integer,
  unit_price       numeric(12,4),
  created_at       timestamptz not null default now(),
  primary key (campaign_id, tracked_video_id)
);

-- ───────── 計測時系列（差分グラフ・監査用）─────────
create table public.view_snapshots (
  tracked_video_id uuid not null references public.tracked_videos(id) on delete cascade,
  captured_at      timestamptz not null default now(),
  views            bigint not null,                    -- attributable（baseline 差し引き後）
  raw_views        bigint,                             -- provider が返した生値（監査用）
  primary key (tracked_video_id, captured_at)
);
create index idx_snapshots_time on public.view_snapshots(captured_at);

-- ───────── due な動画を安全に claim（FOR UPDATE SKIP LOCKED）─────────
-- 複数 tick が同時に走っても二重取得しない。next_check_at を先送りして in-flight を可視化。
create or replace function public.claim_due_tracked_videos(p_limit int default 500)
returns setof public.tracked_videos
language plpgsql as $$
begin
  return query
  with due as (
    select tv.id
    from public.tracked_videos tv
    where tv.status = 'active' and tv.next_check_at <= now()
    order by tv.next_check_at
    limit p_limit
    for update skip locked
  )
  update public.tracked_videos tv
     set next_check_at = now() + interval '15 minutes'   -- in-flight ロック（成功時に正規 interval で上書き）
  from due
  where tv.id = due.id
  returning tv.*;
end $$;

-- ───────── RLS ─────────
alter table public.campaigns            enable row level security;
alter table public.tracked_videos       enable row level security;
alter table public.view_snapshots       enable row level security;
alter table public.campaign_video_links enable row level security;

create policy campaigns_owner on public.campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy tracked_owner on public.tracked_videos
  for select using (
    exists (select 1 from public.campaigns c where c.id = tracked_videos.campaign_id and c.owner_id = auth.uid())
  );

create policy snapshots_owner on public.view_snapshots
  for select using (
    exists (
      select 1 from public.tracked_videos tv
      join public.campaigns c on c.id = tv.campaign_id
      where tv.id = view_snapshots.tracked_video_id and c.owner_id = auth.uid()
    )
  );

create policy links_owner on public.campaign_video_links
  for select using (
    exists (select 1 from public.campaigns c where c.id = campaign_video_links.campaign_id and c.owner_id = auth.uid())
  );
