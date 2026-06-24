#!/usr/bin/env bash
cd /Users/seiyo/coding-zerogrid-app/zeroguri-tracker/scraper || exit 1
set -a
[ -f .env ] && . ./.env
set +a
exec ./.venv/bin/python -m zeroguri_scraper.worker
