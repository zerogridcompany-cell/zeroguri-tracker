-- 0009_campaign_create_organizer_only.sql
-- 案件の「作成」はオーガナイザーのみ（クリエイターは参加だけ）。
-- 既存の campaigns_owner(for all) を分割し、INSERT に is_organizer() を要求する。

drop policy if exists campaigns_owner on public.campaigns;

-- 閲覧: 自分の案件（campaigns_read_active で active も別途許可済み）
create policy campaigns_select_own on public.campaigns
  for select using (auth.uid() = owner_id);

-- 作成: オーガナイザーのみ
create policy campaigns_insert_org on public.campaigns
  for insert with check (auth.uid() = owner_id and public.is_organizer());

-- 更新（終了など）/ 削除: 主催者本人のみ
create policy campaigns_update_own on public.campaigns
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy campaigns_delete_own on public.campaigns
  for delete using (auth.uid() = owner_id);
