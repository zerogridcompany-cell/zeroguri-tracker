-- 0062: 自動承認トグル。オーガナイザーがONにすると、提出が届き次第そのまま承認される。
create table if not exists public.org_settings (
  id int primary key default 1,
  auto_approve boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint org_settings_singleton check (id = 1)
);
insert into public.org_settings (id, auto_approve) values (1, false) on conflict (id) do nothing;
-- RLS有効・クライアント直アクセスは不可（読み書きは service_role 関数経由）。状態はorganizer-submissionsが返す。
alter table public.org_settings enable row level security;
