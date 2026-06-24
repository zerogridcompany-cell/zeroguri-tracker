-- 0029: 案件の単価・予算上限のガード。
-- 単価0だと予算上限（金額）の cap_factor 計算が NULL → 上限が効かなくなる事故を防ぐ。
-- 予算上限を設定する場合は cap_value > 0 を必須にする。
alter table public.campaigns
  add constraint campaigns_unit_price_positive check (unit_price > 0);

alter table public.campaigns
  add constraint campaigns_cap_value_positive
  check (cap_type is null or (cap_value is not null and cap_value > 0));
