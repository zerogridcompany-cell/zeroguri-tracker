"""メインループ：claim → scrape(Playwright) → state machine → 書き戻し。

常駐（POLL_INTERVAL ごとに1サイクル）。RUN_ONCE=true で1サイクルだけ実行して終了
（cron コンテナ運用向け）。
"""
from __future__ import annotations

import asyncio
import logging
import os

from playwright.async_api import BrowserContext, async_playwright

from .config import load_settings, proxy_dict, Settings
from .models import ScrapeResult, TrackedVideo
from .scrapers.base import get_scraper
from .state_machine import compute_update
from .supabase_client import SupabaseClient

log = logging.getLogger("zeroguri.worker")

# bot 検知回避の最小スクリプト（headless の痕跡を隠す。TikTok/IG 対策）。
_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['ja-JP','ja','en-US','en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
window.chrome = window.chrome || { runtime: {} };
"""


async def process_video(context: BrowserContext, client: SupabaseClient, video: TrackedVideo) -> bool:
    try:
        scrape = get_scraper(video.platform)
        result = await scrape(context, video)
    except Exception as e:  # スクレイパ内の想定外も取得失敗として扱う
        result = ScrapeResult(views=None, ok=False, error=str(e))

    current = result.views if (result.ok and result.views is not None) else None
    if current is None:
        log.warning("scrape miss %s/%s: %s", video.platform, video.content_id, result.error)

    upd, snap = compute_update(video, current)
    await client.update_video(video.id, upd)
    if snap is not None:
        await client.insert_snapshot(video.id, snap["views"], snap["raw_views"])
    return current is not None


async def run_cycle(context: BrowserContext, client: SupabaseClient, settings: Settings) -> dict:
    videos = await client.claim_due(settings.batch_limit)
    if not videos:
        return {"claimed": 0}
    ok = 0
    for v in videos:
        if await process_video(context, client, v):
            ok += 1
    return {"claimed": len(videos), "ok": ok, "fail": len(videos) - ok}


async def build_context(browser, settings: Settings) -> BrowserContext:
    context = await browser.new_context(
        user_agent=settings.user_agent,
        locale="ja-JP",
        viewport={"width": 1280, "height": 900},
    )
    context.set_default_navigation_timeout(settings.nav_timeout_ms)
    context.set_default_timeout(settings.nav_timeout_ms)
    # bot 検知回避（TikTok/IG 対策）: 自然なヘッダ + headless 痕跡の除去。
    await context.set_extra_http_headers({
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    })
    await context.add_init_script(_STEALTH_JS)
    # Instagram はログアウトだと再生数が出ないため、sessionid cookie があれば注入。
    if settings.ig_session_cookie:
        await context.add_cookies([{
            "name": "sessionid",
            "value": settings.ig_session_cookie,
            "domain": ".instagram.com",
            "path": "/",
            "httpOnly": True,
            "secure": True,
        }])
    return context


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    run_once = os.environ.get("RUN_ONCE", "").strip().lower() in ("1", "true", "yes")
    client = SupabaseClient(settings)
    proxy = proxy_dict(settings)
    log.info(
        "worker start: poll=%ss batch=%s proxy=%s headless=%s run_once=%s",
        settings.poll_interval, settings.batch_limit, bool(proxy), settings.headless, run_once,
    )
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=settings.headless, proxy=proxy)
        try:
            while True:
                context = await build_context(browser, settings)
                try:
                    stats = await run_cycle(context, client, settings)
                    log.info("cycle: %s", stats)
                except Exception as e:
                    log.exception("cycle failed: %s", e)
                finally:
                    await context.close()
                if run_once:
                    break
                await asyncio.sleep(settings.poll_interval)
        finally:
            await browser.close()
            await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
