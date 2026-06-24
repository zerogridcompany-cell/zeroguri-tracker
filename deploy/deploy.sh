#!/usr/bin/env bash
# ZeroGuri Tracker — フルデプロイ（Supabase へ migration + secrets + Edge Functions + cron）
#
# 必要な環境変数:
#   SUPABASE_ACCESS_TOKEN  … https://supabase.com/dashboard/account/tokens で発行する個人アクセストークン
# 前提: supabase/.env.local が埋まっていること（SERVICE_ROLE_KEY / TOKEN_ENC_KEY / 各 platform キー）。
#
# 使い方:
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./deploy/deploy.sh
set -euo pipefail

REF="xapgynzijixztvrucppe"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/supabase/.env.local"
MGMT="https://api.supabase.com/v1/projects/$REF"

[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "ERROR: set SUPABASE_ACCESS_TOKEN"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

run_sql_file() {
  local f="$1"
  echo "  → applying $(basename "$f") ..."
  local payload
  payload="$(node -e "const fs=require('fs');process.stdout.write(JSON.stringify({query:fs.readFileSync(process.argv[1],'utf8')}))" "$f")"
  curl -sS -X POST "$MGMT/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" | head -c 400; echo
}

run_sql_inline() {
  local sql="$1"
  curl -sS -X POST "$MGMT/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(node -e "process.stdout.write(JSON.stringify({query:process.argv[1]}))" "$sql")" | head -c 200; echo
}

echo "== 1. migrations =="
run_sql_file "$HERE/deploy/all_migrations.sql"

echo "== 2. cron 用 GUC（functions_url / service_role_key）=="
run_sql_inline "alter database postgres set app.settings.functions_url = 'https://$REF.supabase.co/functions/v1';"
run_sql_inline "alter database postgres set app.settings.service_role_key = '$SUPABASE_SERVICE_ROLE_KEY';"

echo "== 3. function secrets =="
supabase secrets set --project-ref "$REF" --env-file "$ENV_FILE" >/dev/null && echo "  secrets set ✓"

echo "== 4. deploy Edge Functions =="
PUBLIC_FNS="oauth-callback tracking-tick refresh-tokens"           # verify_jwt=false
JWT_FNS="youtube-oauth-url tiktok-oauth-url instagram-oauth-url link-challenge-create link-challenge-verify revoke-oauth-token register-tracked-video dashboard-summary"
cd "$HERE"
for fn in $PUBLIC_FNS; do
  echo "  → $fn (public)"; supabase functions deploy "$fn" --project-ref "$REF" --no-verify-jwt >/dev/null
done
for fn in $JWT_FNS; do
  echo "  → $fn (jwt)"; supabase functions deploy "$fn" --project-ref "$REF" >/dev/null
done

echo "== DONE =="
echo "Functions base: https://$REF.supabase.co/functions/v1"
echo "Smoke test (sandbox tick): curl -s https://$REF.supabase.co/functions/v1/tracking-tick"
