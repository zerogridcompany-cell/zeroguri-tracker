-- 0037: 配分を「生再生数ベース」に修正。
-- credited_views = 確定済みの“生”再生数（単調増加）。billing/表示時に floor(credited/1000)*1000 する。
-- 境界（取り合い）は残り枠を生再生数の delta で最大剰余法配分し、残り枠を端数まで正確に消費。
-- 例: 残り1000・delta A1500/B1000/C500 → A=500/B=333/C=167（ユーザー承認プレビュー通り）。
create or replace function public.allocate_campaign_credits() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  c record; v_cap_views numeric; v_total_credited numeric; v_remaining bigint; v_total_delta numeric;
begin
  for c in select id, cap_value, cap_type, unit_price from public.campaigns where status='active' order by id loop
    perform 1 from public.campaigns where id=c.id for update;

    insert into public.campaign_user_credit (campaign_id, user_id)
    select c.id, la.user_id from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
    where tv.campaign_id=c.id group by la.user_id on conflict (campaign_id,user_id) do nothing;

    if c.cap_value is null or c.cap_type is null then v_cap_views:=null;
    elsif c.cap_type='views' then v_cap_views:=c.cap_value;
    else v_cap_views:=floor(c.cap_value/nullif(c.unit_price,0)); end if;

    -- 上限なし → 現在の生再生数まで確定（単調増加）
    if v_cap_views is null then
      update public.campaign_user_credit cuc set credited_views=sub.cur_raw, updated_at=now()
      from (select la.user_id, sum(least(tv.last_views,tv.cap::bigint)) as cur_raw
            from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
            where tv.campaign_id=c.id group by la.user_id) sub
      where cuc.campaign_id=c.id and cuc.user_id=sub.user_id and sub.cur_raw>cuc.credited_views;
      continue;
    end if;

    select coalesce(sum(credited_views),0) into v_total_credited from public.campaign_user_credit where campaign_id=c.id;
    v_remaining := floor(v_cap_views - v_total_credited);
    if v_remaining<=0 then continue; end if;

    select coalesce(sum(greatest(0, s.cur_raw - cuc.credited_views)),0) into v_total_delta
    from (select la.user_id, sum(least(tv.last_views,tv.cap::bigint)) as cur_raw
          from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
          where tv.campaign_id=c.id group by la.user_id) s
    join public.campaign_user_credit cuc on cuc.campaign_id=c.id and cuc.user_id=s.user_id;
    if v_total_delta<=0 then continue; end if;

    if v_total_delta <= v_remaining then
      -- 全額確定（生 delta をそのまま）
      update public.campaign_user_credit cuc set credited_views=cuc.credited_views+sub.delta, updated_at=now()
      from (select s.user_id, greatest(0, s.cur_raw - cuc.credited_views) as delta
            from (select la.user_id, sum(least(tv.last_views,tv.cap::bigint)) as cur_raw
                  from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
                  where tv.campaign_id=c.id group by la.user_id) s
            join public.campaign_user_credit cuc on cuc.campaign_id=c.id and cuc.user_id=s.user_id) sub
      where cuc.campaign_id=c.id and cuc.user_id=sub.user_id and sub.delta>0;
    else
      -- 境界: 残り v_remaining を生 delta で按分（最大剰余法・端数まで正確に消費）
      update public.campaign_user_credit cuc set credited_views=cuc.credited_views+alloc.add_views, updated_at=now()
      from (
        with d as (
          select s.user_id, greatest(0, s.cur_raw - cuc.credited_views) as delta
          from (select la.user_id, sum(least(tv.last_views,tv.cap::bigint)) as cur_raw
                from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
                where tv.campaign_id=c.id group by la.user_id) s
          join public.campaign_user_credit cuc on cuc.campaign_id=c.id and cuc.user_id=s.user_id
        ),
        pos as (select user_id, delta from d where delta>0),
        tot as (select sum(delta) td from pos),
        base as (
          select p.user_id, p.delta,
            floor(v_remaining * p.delta / t.td)::bigint as base_v,
            (v_remaining * p.delta) - floor(v_remaining * p.delta / t.td) * t.td as rem_num
          from pos p cross join tot t
        ),
        ranked as (
          select user_id, base_v,
            row_number() over (order by rem_num desc, delta desc, user_id) as rn,
            (v_remaining - coalesce(sum(base_v) over (),0)) as leftover
          from base
        )
        select user_id, (base_v + case when rn<=leftover then 1 else 0 end) as add_views from ranked
      ) alloc
      where cuc.campaign_id=c.id and cuc.user_id=alloc.user_id and alloc.add_views>0;
    end if;
  end loop;
end $fn$;
