-- 0020_rename_campaign.sql — オーガナイザーが案件名を変更できる安全な関数
-- （直接 update の RLS 依存をやめ、オーガナイザー権限で確実に更新）
create or replace function public.rename_campaign(p_campaign_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select au.email into v_email from public.app_users au where au.id = auth.uid();
  if not exists (select 1 from public.organizer_emails oe where lower(oe.email) = lower(coalesce(v_email,'__none__'))) then
    raise exception 'forbidden: organizer only';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'empty title'; end if;
  update public.campaigns set title = btrim(p_title) where id = p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;
end $$;
grant execute on function public.rename_campaign(uuid, text) to authenticated;
