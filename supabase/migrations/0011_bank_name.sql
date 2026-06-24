-- 0011_bank_name.sql — 銀行名・支店名を追加（全銀フォーマット表示用）
alter table public.profiles
  add column if not exists bank_name   text,   -- 銀行名
  add column if not exists branch_name text;    -- 支店名
