-- 0023 — 引き出しリクエストのキャンセル（本人が自分の pending を削除できる）
-- 削除すると pending が消え、保留中で差し引かれていた額が残高に戻る（返金）。
drop policy if exists payout_delete_self on public.payout_requests;
create policy payout_delete_self on public.payout_requests
  for delete using (auth.uid() = user_id and status = 'pending');
