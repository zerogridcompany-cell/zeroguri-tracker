-- 0013_zeroguri_fee.sql — ゼログリ手数料の自動計算
-- ゼログリ手数料 = 報酬総額(amount) × 8% ＋ 330円
-- payout_requests INSERT 時に自動でセット（オーガナイザーは後から update で上書き可）。

create or replace function public.set_payout_fee()
returns trigger language plpgsql as $$
begin
  new.fee := round(new.amount * 0.08) + 330;
  return new;
end $$;

drop trigger if exists trg_payout_fee on public.payout_requests;
create trigger trg_payout_fee before insert on public.payout_requests
  for each row execute function public.set_payout_fee();

-- 既定値も式に合わせて更新（参考。実際の値はトリガが設定）
alter table public.payout_requests alter column fee set default 330;
