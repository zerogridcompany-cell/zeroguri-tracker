"""YouTube（通常動画 / Shorts）の再生回数スクレイパ。

ytInitialPlayerResponse.videoDetails.viewCount から厳密な整数を取得する。
"""
from __future__ import annotations

import re

from ..models import ScrapeResult, TrackedVideo
from .base import parse_int, resolve_target_url

# ytInitialPlayerResponse.videoDetails.viewCount: 厳密な整数文字列
_VIEWCOUNT_RE = re.compile(r'"viewCount":"(\d+)"')


async def scrape(context, video: TrackedVideo) -> ScrapeResult:
    """YouTube 動画の再生回数を取得する。"""
    url = resolve_target_url(video)
    if not url:
        return ScrapeResult(views=None, ok=False, error="bad_url")

    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded")

        # (1) page.content() への正規表現（最も確実な厳密整数）
        try:
            html = await page.content()
        except Exception:
            html = ""
        m = _VIEWCOUNT_RE.search(html)
        if m:
            views = parse_int(m.group(1))
            if views is not None:
                return ScrapeResult(views=views, ok=True)

        # (2) window.ytInitialPlayerResponse から直接読む
        try:
            raw = await page.evaluate(
                "() => window.ytInitialPlayerResponse"
                " && window.ytInitialPlayerResponse.videoDetails"
                " && window.ytInitialPlayerResponse.videoDetails.viewCount"
            )
        except Exception:
            raw = None
        if raw:
            views = parse_int(raw)
            if views is not None:
                return ScrapeResult(views=views, ok=True)

        # (3) meta itemprop="interactionCount" の content フォールバック
        try:
            meta = await page.evaluate(
                "() => { const el = document.querySelector('meta[itemprop=\"interactionCount\"]');"
                " return el && el.getAttribute('content'); }"
            )
        except Exception:
            meta = None
        if meta:
            views = parse_int(meta)
            if views is not None:
                return ScrapeResult(views=views, ok=True)

        return ScrapeResult(views=None, ok=False, error="no_viewcount")
    except Exception as e:
        return ScrapeResult(views=None, ok=False, error=type(e).__name__)
    finally:
        await page.close()
