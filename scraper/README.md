# ZeroGuri Tracker — Scraper Worker

A Playwright (Chromium, headless) worker that tracks social-media view counts.

## What it does

Each cycle the worker:

1. **Polls Supabase** for the active set of tracking targets (claims up to
   `BATCH_LIMIT` per cycle).
2. **Scrapes** each target with Playwright (YouTube / TikTok / Instagram).
3. Runs a **state machine** to advance each target's tracking state.
4. **Writes results back** to Supabase.

It then sleeps for `POLL_INTERVAL_SEC` and repeats, unless `RUN_ONCE=true`.

Entrypoint: `python -m zeroguri_scraper.worker`

## Local run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium          # only needed locally (not in Docker)

cp .env.example .env                  # then fill in SUPABASE_URL + SERVICE_ROLE_KEY
# load the env however you like (e.g. `set -a; source .env; set +a`)

python -m zeroguri_scraper.worker
```

Set `RUN_ONCE=true` to run exactly one cycle and exit (useful for testing or
cron-style scheduling).

## Configuration

All settings come from environment variables — see `.env.example` for the full
list and defaults. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required;
`IG_SESSION_COOKIE` and `PROXY_URL` are needed for reliable Instagram scraping.

## Deploy to Railway

1. Create a **new Railway project** from this repo.
2. Set the service **root directory** to `scraper/` (this folder, the Docker
   build context).
3. Railway builds from the `Dockerfile` (browsers preinstalled) and starts
   `python -m zeroguri_scraper.worker` with `ON_FAILURE` restarts — see
   `railway.json`.
4. Add the environment variables from `.env.example` in the service settings.

For cron-style deploys, set `RUN_ONCE=true` and trigger the service on a
schedule instead of running it as a long-lived daemon.

## Platform notes (honest reliability)

- **YouTube** — reliable. Works logged-out; no session or proxy required.
- **TikTok** — works but is anti-bot heavy; a (residential) `PROXY_URL` is
  usually needed to avoid challenges. Stay logged-out.
- **Instagram** — least reliable. Requires `IG_SESSION_COOKIE` (a logged-in
  `sessionid`) **and** a residential `PROXY_URL`; expect occasional failures.

Only Instagram uses a session cookie. Keep YouTube and TikTok **logged-out**.
