-- 0027: pending_link_challenges の platform チェックに tiktok を追加。
-- 旧制約は ('youtube','instagram') のみで、TikTok 連携のコード発行が
-- check constraint 違反で失敗していた（無審査ルートで TikTok も対応するため修正）。
alter table public.pending_link_challenges
  drop constraint if exists pending_link_challenges_platform_check;

alter table public.pending_link_challenges
  add constraint pending_link_challenges_platform_check
  check (platform = any (array['youtube'::text, 'tiktok'::text, 'instagram'::text]));
