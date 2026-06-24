-- 0058: 提出に campaign_id を保持（手動提出の承認時に、確実に正しい案件へトラッキング登録するため）。
--  linked_accounts.campaign_id が null のケースに備え、提出時の案件を提出レコード自体に持たせる。
alter table public.video_submissions add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
