-- 0015_ownership_method.sql — ownership_method の許可値に bio_challenge を追加
-- link-challenge-verify が bio-code 照合済みの連携を 'bio_challenge' として記録するため。
alter table public.linked_accounts
  drop constraint if exists linked_accounts_ownership_method_check;

alter table public.linked_accounts
  add constraint linked_accounts_ownership_method_check
  check (ownership_method = any (array['challenge', 'oauth', 'bio_challenge', 'handle_trust']));
