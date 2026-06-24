-- 0016_unlink_account.sql — 連携解除（本人が自分の linked_accounts を削除可能に）
-- tracked_videos.linked_account_id は ON DELETE CASCADE なので、解除で当該アカウントの
-- 計測動画も自動削除される。
drop policy if exists linked_delete_self on public.linked_accounts;
create policy linked_delete_self on public.linked_accounts
  for delete using (auth.uid() = user_id);
