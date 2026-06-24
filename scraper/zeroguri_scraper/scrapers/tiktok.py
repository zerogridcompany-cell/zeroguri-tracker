"""TikTok スクレイパ。

再生数は <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> の JSON
…itemInfo.itemStruct.stats(.V2).playCount に埋め込まれている（SIGI_STATE も併用）。

堅牢化（2026-06）:
- vt./vm. 短縮共有リンクは httpx で canonical（/@user/video/ID）へ事前解決。
- goto 後に playCount が DOM に載るまで待機（domcontentloaded 直後は未注入のことがある）。
- **playCount を最優先で抽出し、取れたら即成功**（正規ページの JS にも "/captcha" 等が
  含まれるため、wall マーカーで先に弾かない）。取れなければURLが login/captcha の時のみ
  bot_wall、それ以外は1回リロードして parse_failed。
"""
from __future__ import annotations

import re

import httpx

from ..models import ScrapeResult, TrackedVideo
from .base import parse_int, resolve_target_url

# 埋め込み JSON 内の再生数。
_PLAY_COUNT_RE = re.compile(r'"playCount":\s*(\d+)')

# 短縮共有リンク（要リダイレクト解決）。
_SHORT_HOSTS = ("vt.tiktok.com", "vm.tiktok.com")

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


async def _expand_short(url: str) -> str:
    """vt./vm. 短縮リンクを canonical www.tiktok.com/@user/video/ID に解決。失敗時は素のまま。"""
    if not any(h in url for h in _SHORT_HOSTS):
        return url.split("?", 1)[0]
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15, headers={"User-Agent": _UA}
        ) as c:
            r = await c.get(url)
            return str(r.url).split("?", 1)[0]
    except Exception:
        return url.split("?", 1)[0]


async def _read_play_count_js(page) -> str | None:
    """rehydration / SIGI_STATE の JSON を walk して playCount を取得。"""
    try:
        return await page.evaluate(
            """() => {
                const pick = (st) => (st && st.playCount != null) ? String(st.playCount) : null;
                // 1) __UNIVERSAL_DATA_FOR_REHYDRATION__
                const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
                if (el) {
                    try {
                        const d = JSON.parse(el.textContent);
                        const sc = d && d.__DEFAULT_SCOPE__;
                        const det = sc && sc['webapp.video-detail'];
                        const st = det && det.itemInfo && det.itemInfo.itemStruct;
                        const v = pick(st && (st.statsV2 || st.stats));
                        if (v != null) return v;
                    } catch (e) {}
                }
                // 2) SIGI_STATE.ItemModule
                const s = document.getElementById('SIGI_STATE');
                if (s) {
                    try {
                        const d = JSON.parse(s.textContent);
                        const items = d && d.ItemModule;
                        if (items) for (const k in items) {
                            const v = pick(items[k] && items[k].stats);
                            if (v != null) return v;
                        }
                    } catch (e) {}
                }
                return null;
            }"""
        )
    except Exception:
        return None


def _extract(html: str) -> int | None:
    m = _PLAY_COUNT_RE.search(html)
    if m:
        return parse_int(m.group(1))
    return None


async def scrape(context, video: TrackedVideo) -> ScrapeResult:
    url = resolve_target_url(video)
    if not url:
        return ScrapeResult(views=None, ok=False, error="no_url")
    url = await _expand_short(url)

    page = await context.new_page()
    try:
        for attempt in (1, 2):
            try:
                await page.goto(url, wait_until="domcontentloaded")
            except Exception as e:
                msg = (str(e) or e.__class__.__name__).splitlines()[0].lower()
                if "timeout" in msg and attempt == 1:
                    continue
                return ScrapeResult(
                    views=None, ok=False, error="timeout" if "timeout" in msg else (msg[:80] or "error")
                )

            # playCount が DOM に載るまで待機（最大8秒、無ければ2秒だけ待って続行）。
            try:
                await page.wait_for_function(
                    "() => document.documentElement.innerHTML.indexOf('\"playCount\"') !== -1",
                    timeout=8000,
                )
            except Exception:
                await page.wait_for_timeout(2000)

            # ── playCount 最優先抽出（取れたら成功） ──
            html = await page.content()
            views = _extract(html)
            if views is None:
                raw = await _read_play_count_js(page)
                if raw is not None:
                    views = parse_int(raw)
            if views is not None:
                return ScrapeResult(views=views, ok=True)

            # 取れなかった場合のみ wall 判定（URL 自体が login/captcha の時だけ）。
            cur = (page.url or "").lower()
            if "/login" in cur or "/captcha" in cur:
                return ScrapeResult(views=None, ok=False, error="bot_wall")
            if attempt == 1:
                await page.wait_for_timeout(1500)
                continue

        return ScrapeResult(views=None, ok=False, error="parse_failed")
    finally:
        await page.close()
