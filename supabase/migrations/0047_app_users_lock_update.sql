-- 0047: app_users への UPDATE をクライアントから完全に禁止（0046 の修正）。
-- PostgreSQL ではテーブル単位 GRANT UPDATE から特定列だけを REVOKE できない
-- （0046 の `revoke update (email)` は no-op だった）。app_users はクライアントから
-- 一切 UPDATE されない（email/display_name/avatar_url は auth トリガ=definer が設定）ため、
-- テーブル単位の UPDATE 権限ごと剥奪する。これでオーガナイザー昇格（email 書換え）を確実に封じる。
revoke update on public.app_users from authenticated, anon;
