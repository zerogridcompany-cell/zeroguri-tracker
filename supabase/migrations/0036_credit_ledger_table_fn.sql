-- 0036: キャップ「確定ロック＋境界按分」の中核。
-- (案件×ユーザー) ごとに確定済み再生数 credited_views を単調増加で積む台帳＋配分関数。

create table if not exists public.campaign_user_credit (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  credited_views bigint not null default 0,   -- 確定済み（1000ブロック単位・単調増加）
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index if not exists idx_cuc_campaign on public.campaign_user_credit (campaign_id);
alter table public.campaign_user_credit enable row level security;

-- 配分関数: active 案件ごとに行ロックして確定を積む。
-- ・キャップ未到達 → 各ユーザーの現在ブロックまで全額確定（cur = floor(sum(least(last_views,cap))/1000)*1000）。
-- ・キャップ直前の取り合い → 残り枠を「その回の増加分(delta)」で1000ブロック按分（最大剰余法）。
-- ・確定は単調増加（既存 credited は減らさない）。冪等。
create or replace function public.allocate_campaign_credits() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  c record;
  v_cap_views numeric;
  v_total_credited numeric;
  v_remaining_blocks bigint;
  v_total_delta numeric;
begin
  for c in select id, cap_value, cap_type, unit_price from public.campaigns where status = 'active' loop
    perform 1 from public.campaigns where id = c.id for update;

    -- このサイクルで動画を持つユーザーの行を用意
    insert into public.campaign_user_credit (campaign_id, user_id)
    select c.id, la.user_id
    from public.tracked_videos tv join public.linked_accounts la on la.id = tv.linked_account_id
    where tv.campaign_id = c.id
    group by la.user_id
    on conflict (campaign_id, user_id) do nothing;

    -- cap_views（NULL=上限なし）
    if c.cap_value is null or c.cap_type is null then
      v_cap_views := null;
    elsif c.cap_type = 'views' then
      v_cap_views := c.cap_value;
    else
      v_cap_views := floor(c.cap_value / nullif(c.unit_price, 0));
    end if;

    -- 上限なし → 各ユーザーの現在ブロックまで確定（単調増加）
    if v_cap_views is null then
      update public.campaign_user_credit cuc
      set credited_views = sub.cur, updated_at = now()
      from (
        select la.user_id, floor(sum(least(tv.last_views, tv.cap::bigint))/1000.0)*1000 as cur
        from public.tracked_videos tv join public.linked_accounts la on la.id = tv.linked_account_id
        where tv.campaign_id = c.id group by la.user_id
      ) sub
      where cuc.campaign_id = c.id and cuc.user_id = sub.user_id and sub.cur > cuc.credited_views;
      continue;
    end if;

    select coalesce(sum(credited_views),0) into v_total_credited from public.campaign_user_credit where campaign_id = c.id;
    v_remaining_blocks := floor((v_cap_views - v_total_credited) / 1000.0);
    if v_remaining_blocks <= 0 then continue; end if;

    -- 未確定差分 delta（ブロック単位）の合計
    select coalesce(sum(greatest(0, floor(sum_raw/1000.0)*1000 - cuc.credited_views)),0) into v_total_delta
    from (
      select la.user_id, sum(least(tv.last_views, tv.cap::bigint)) as sum_raw
      from public.tracked_videos tv join public.linked_accounts la on la.id = tv.linked_account_id
      where tv.campaign_id = c.id group by la.user_id
    ) s
    join public.campaign_user_credit cuc on cuc.campaign_id = c.id and cuc.user_id = s.user_id;

    if v_total_delta <= 0 then continue; end if;

    if (v_total_delta / 1000.0) <= v_remaining_blocks then
      -- 全額確定
      update public.campaign_user_credit cuc
      set credited_views = cuc.credited_views + sub.delta, updated_at = now()
      from (
        select s.user_id, greatest(0, floor(s.sum_raw/1000.0)*1000 - cuc.credited_views) as delta
        from (
          select la.user_id, sum(least(tv.last_views, tv.cap::bigint)) as sum_raw
          from public.tracked_videos tv join public.linked_accounts la on la.id = tv.linked_account_id
          where tv.campaign_id = c.id group by la.user_id
        ) s
        join public.campaign_user_credit cuc on cuc.campaign_id = c.id and cuc.user_id = s.user_id
      ) sub
      where cuc.campaign_id = c.id and cuc.user_id = sub.user_id and sub.delta > 0;
    else
      -- 境界: 残り v_remaining_blocks ブロックを delta按分（最大剰余法）
      update public.campaign_user_credit cuc
      set credited_views = cuc.credited_views + alloc.blocks*1000, updated_at = now()
      from (
        with d as (
          select s.user_id, greatest(0, floor(s.sum_raw/1000.0)*1000 - cuc.credited_views) as delta
          from (
            select la.user_id, sum(least(tv.last_views, tv.cap::bigint)) as sum_raw
            from public.tracked_videos tv join public.linked_accounts la on la.id = tv.linked_account_id
            where tv.campaign_id = c.id group by la.user_id
          ) s
          join public.campaign_user_credit cuc on cuc.campaign_id = c.id and cuc.user_id = s.user_id
        ),
        pos as (select user_id, delta from d where delta > 0),
        tot as (select sum(delta) td from pos),
        base as (
          select p.user_id, p.delta,
            floor((v_remaining_blocks * p.delta) / t.td)::bigint as base_blocks,
            (v_remaining_blocks * p.delta) - floor((v_remaining_blocks * p.delta) / t.td) * t.td as rem_num
          from pos p cross join tot t
        ),
        ranked as (
          select user_id, base_blocks,
            row_number() over (order by rem_num desc, delta desc, user_id) as rn,
            (v_remaining_blocks - coalesce(sum(base_blocks) over (), 0)) as leftover
          from base
        )
        select user_id, (base_blocks + case when rn <= leftover then 1 else 0 end) as blocks from ranked
      ) alloc
      where cuc.campaign_id = c.id and cuc.user_id = alloc.user_id and alloc.blocks > 0;
    end if;
  end loop;
end $fn$;
