-- 0021 — オーガナイザーは自分が作っていない案件も管理できる（終了/再開/削除）
-- organizer-summary が全案件を返すため、管理操作も is_organizer() で許可する。
drop policy if exists campaigns_update_org on public.campaigns;
create policy campaigns_update_org on public.campaigns
  for update using (public.is_organizer()) with check (public.is_organizer());

drop policy if exists campaigns_delete_org on public.campaigns;
create policy campaigns_delete_org on public.campaigns
  for delete using (public.is_organizer());
