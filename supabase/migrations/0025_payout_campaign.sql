-- 0025 — 引き出しリクエストに案件を紐付け、案件削除で履歴もカスケード削除
alter table public.payout_requests
  add column if not exists campaign_id uuid references public.campaigns(id) on delete cascade;
-- 既存の孤立リクエスト（案件が既に削除済み = campaign_id 無し）を整理
delete from public.payout_requests where campaign_id is null;
