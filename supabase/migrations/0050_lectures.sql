-- 0050: 講義（ガイド/レッスン）。オーガナイザーが作成・編集、クリエイターは閲覧。
-- 各講義は複数ステップ（step1, step2 …）を持ち、名前・内容を編集できる。
create table if not exists public.lectures (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  sort_order  integer not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.lecture_steps (
  id         uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  idx        integer not null default 0,
  title      text not null,
  body       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_lecture_steps_lecture on public.lecture_steps (lecture_id, idx);

alter table public.lectures enable row level security;
alter table public.lecture_steps enable row level security;

-- 閲覧: ログインユーザーは全員可。編集: オーガナイザーのみ（is_organizer は 0006 で定義）。
drop policy if exists lectures_read on public.lectures;
create policy lectures_read on public.lectures for select using (true);
drop policy if exists lectures_write on public.lectures;
create policy lectures_write on public.lectures for all using (public.is_organizer()) with check (public.is_organizer());

drop policy if exists lecture_steps_read on public.lecture_steps;
create policy lecture_steps_read on public.lecture_steps for select using (true);
drop policy if exists lecture_steps_write on public.lecture_steps;
create policy lecture_steps_write on public.lecture_steps for all using (public.is_organizer()) with check (public.is_organizer());
