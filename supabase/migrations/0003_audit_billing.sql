-- 0003_audit_billing.sql — トークンアクセス監査 + 請求/集計ビュー

-- ───────── トークンアクセス監査（IPO 監査対応）─────────
-- 「誰が・いつ・どのトークンを復号/参照したか」を記録。
create table public.token_access_audit (
  id                uuid primary key default gen_random_uuid(),
  linked_account_id uuid references public.linked_accounts(id) on delete set null,
  accessor          text not null,          -- function 名 or service identity
  action            text not null,          -- 'decrypt' | 'refresh' | 'revoke' | 'read'
  context           jsonb,
  accessed_at       timestamptz not null default now()
);
create index idx_audit_account on public.token_access_audit(linked_account_id);
create index idx_audit_time    on public.token_access_audit(accessed_at);
alter table public.token_access_audit enable row level security;
-- 監査ログはクライアントから読めない（service_role のみ）。ポリシー無し = deny all。

-- ───────── 請求: 動画別 ─────────
-- billable_views = LEAST(attributable, cap)。cap 超過分は請求に無関係。
create or replace view public.v_billable as
select
  tv.id                                   as tracked_video_id,
  tv.campaign_id,
  tv.linked_account_id,
  tv.platform,
  tv.content_id,
  tv.title,
  tv.last_views                           as attributable_views,
  tv.cap,
  least(tv.last_views, tv.cap)            as billable_views,
  tv.unit_price,
  round(least(tv.last_views, tv.cap) * tv.unit_price, 2) as billable_amount,
  tv.status,
  tv.retired_reason,
  tv.next_check_at,
  tv.last_checked_at,
  -- ダッシュボード用ステータス: 計測中 / 完了(cap) / 鈍化 / 引退
  case
    when tv.status = 'active' and tv.stall_count >= 1 then 'slowing'
    when tv.status = 'active'                          then 'tracking'
    when tv.retired_reason = 'cap'                     then 'completed'
    else 'retired'
  end as display_status
from public.tracked_videos tv;

-- ───────── 請求: 案件別サマリー ─────────
create or replace view public.v_campaign_summary as
select
  c.id              as campaign_id,
  c.owner_id,
  c.title,
  c.status,
  count(tv.id)                                            as total_videos,
  count(*) filter (where tv.status = 'active')            as active_videos,
  count(*) filter (where tv.status = 'retired')           as retired_videos,
  coalesce(sum(tv.last_views), 0)                         as total_attributable_views,
  coalesce(sum(least(tv.last_views, tv.cap)), 0)          as total_billable_views,
  coalesce(round(sum(least(tv.last_views, tv.cap) * tv.unit_price), 2), 0) as total_billable_amount
from public.campaigns c
left join public.tracked_videos tv on tv.campaign_id = c.id
group by c.id;

-- ───────── 連携別ダッシュボード集計（active=今コストがかかってる本数）─────────
create or replace view public.v_account_dashboard as
select
  la.id          as linked_account_id,
  la.user_id,
  la.platform,
  la.handle,
  la.status      as connection_status,
  la.is_new_account,
  count(tv.id)                                  as total_videos,
  count(*) filter (where tv.status = 'active')  as active_videos,
  count(*) filter (where tv.status = 'retired') as retired_videos,
  coalesce(round(sum(least(tv.last_views, tv.cap) * tv.unit_price), 2), 0) as billable_amount
from public.linked_accounts la
left join public.tracked_videos tv on tv.linked_account_id = la.id
group by la.id;

-- ビューは barrier security のため security_invoker（呼び出し元の RLS を適用）
alter view public.v_billable          set (security_invoker = true);
alter view public.v_campaign_summary  set (security_invoker = true);
alter view public.v_account_dashboard set (security_invoker = true);
