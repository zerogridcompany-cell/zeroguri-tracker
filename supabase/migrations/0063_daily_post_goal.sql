-- 0063_daily_post_goal.sql — クリエイター個別の「1日あたり目標投稿本数（最低/最高）」
-- 記入は zeroguri-report（合言葉で保護）。ランキング画面で全員に公開表示。
alter table public.profiles
  add column if not exists daily_post_goal_min int,
  add column if not exists daily_post_goal_max int;

comment on column public.profiles.daily_post_goal_min is
  '1日あたりの最低目標投稿本数（全SNS合算）。null=未設定。report で設定、tracker で公開。';
comment on column public.profiles.daily_post_goal_max is
  '1日あたりの最高目標投稿本数（全SNS合算）。null=未設定。';

-- report-goal Edge Function（service_role）から目標を書き込む安全な関数。
-- profiles への service_role の直接UPDATE権限が無いため SECURITY DEFINER（所有者=postgres）で更新。
-- 0 / null / 負 → 未設定(null) に正規化。実行権限は service_role のみ（合言葉ゲートは関数側）。
create or replace function public.set_daily_post_goals(p_user_id uuid, p_min int, p_max int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
    set daily_post_goal_min = case when coalesce(p_min, 0) <= 0 then null else p_min end,
        daily_post_goal_max = case when coalesce(p_max, 0) <= 0 then null else p_max end
    where user_id = p_user_id;
  if not found then raise exception 'profile not found'; end if;
end $$;
revoke all on function public.set_daily_post_goals(uuid, int, int) from public;
grant execute on function public.set_daily_post_goals(uuid, int, int) to service_role;
