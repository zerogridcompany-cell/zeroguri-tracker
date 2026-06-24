-- 0040: mark_payout_paid から cap_factor 撤去（credited方式へ移行）＋ allocate を pg_cron で定期実行。
-- 課金の net は credited gross − 既払い(payout_requests)。video_payout_ledger は「ペイアウト済みログ」用に維持。
create or replace function public.mark_payout_paid(p_request_id uuid, p_fee numeric)
returns public.payout_requests
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_req public.payout_requests;
  v_email text;
  rec record;
  v_old bigint;
  v_delta_amt numeric;
begin
  select au.email into v_email from public.app_users au where au.id = auth.uid();
  if not exists (select 1 from public.organizer_emails oe where lower(oe.email) = lower(coalesce(v_email,'__none__'))) then
    raise exception 'forbidden: organizer only';
  end if;

  update public.payout_requests
     set status='paid', fee=coalesce(p_fee, fee), paid_at=now()
   where id=p_request_id returning * into v_req;
  if v_req.id is null then raise exception 'payout request not found'; end if;

  -- 「ペイアウト済みログ」用の per動画 台帳（cap_factor なし）
  if v_req.campaign_id is not null then
    for rec in
      select tv.platform, tv.content_id, tv.title, tv.unit_price, la.handle,
             least(tv.last_views, tv.cap::bigint)::bigint as gross_bv
        from public.tracked_videos tv join public.linked_accounts la on la.id=tv.linked_account_id
       where la.user_id=v_req.user_id and tv.campaign_id=v_req.campaign_id
    loop
      select coalesce(paid_views,0) into v_old from public.video_payout_ledger
       where campaign_id=v_req.campaign_id and platform=rec.platform and content_id=rec.content_id;
      v_old := coalesce(v_old,0);
      if rec.gross_bv > v_old then
        v_delta_amt := round((rec.gross_bv - v_old) * rec.unit_price);
        insert into public.video_payout_ledger
          (campaign_id,user_id,platform,content_id,handle,title,paid_views,paid_amount,last_payout_request_id,last_paid_at,updated_at)
        values
          (v_req.campaign_id,v_req.user_id,rec.platform,rec.content_id,rec.handle,rec.title,rec.gross_bv,v_delta_amt,p_request_id,now(),now())
        on conflict (campaign_id,platform,content_id) do update
          set paid_views=rec.gross_bv,
              paid_amount=public.video_payout_ledger.paid_amount + v_delta_amt,
              handle=excluded.handle, title=coalesce(excluded.title, public.video_payout_ledger.title),
              user_id=excluded.user_id, last_payout_request_id=excluded.last_payout_request_id,
              last_paid_at=now(), updated_at=now();
      end if;
    end loop;
  end if;
  return v_req;
end $function$;

-- 確定台帳の配分を5分ごとに実行（スクレイプで増えたviewを確定／キャップ境界を裁く）
select cron.schedule('zeroguri-allocate-credits', '*/5 * * * *', $$select public.allocate_campaign_credits();$$);
