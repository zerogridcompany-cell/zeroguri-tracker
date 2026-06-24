"""Instagram Reels の再生数スクレイパ。

IG が表示する「再生数」は video_play_count。これは web_profile_info の
video_view_count(視聴回数=過小) とは別物。video_play_count はログアウトでは普通取れないが、
**reel ページから lsd トークンを取り、GraphQL(PolarisPostActionLoadPostQueryQuery) を叩くと
ログインなしで video_play_count が返る**（検証: DT7bMvnkjm5 → 392,419）。

優先順:
 1) GraphQL(lsd) → video_play_count（=表示される再生数。ログアウト可）。
 2) web_profile_info → video_view_count（視聴回数。再生数より小さいが取得は確実）。
 3) ページ scrape（IG_SESSION_COOKIE があれば埋め込み再生数）。
"""
from __future__ import annotations

import json
import re

import httpx

from ..models import ScrapeResult, TrackedVideo
from .base import parse_int, resolve_target_url

_APPID = "936619743392459"
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# PolarisPostActionLoadPostQueryQuery（shortcode → media）。将来 IG が rotate したら要更新。
_DOC_ID = "8845758582119845"

_PLAYCOUNT_RES = (
    re.compile(r'"play_count":\s*(\d+)'),
    re.compile(r'"video_view_count":\s*(\d+)'),
    re.compile(r'"video_play_count":\s*(\d+)'),
    re.compile(r'"view_count":\s*(\d+)'),
)
_SHORTCODE_RE = re.compile(r"/(?:reels?|p|tv)/([0-9A-Za-z_-]+)")
_LSD_RE = re.compile(r'"LSD",\[\],\{"token":"([^"]+)"')
_CSRF_RE = re.compile(r'"csrf_token":"([^"]+)"')


def _shortcode(video: TrackedVideo) -> str | None:
    cid = (video.content_id or "").strip()
    if cid and "/" not in cid and "http" not in cid:
        return cid
    for s in (video.url, video.content_id):
        if s:
            m = _SHORTCODE_RE.search(s)
            if m:
                return m.group(1)
    return None


async def _views_via_graphql(shortcode: str) -> int | None:
    """reel ページの lsd トークン → GraphQL で video_play_count(=再生数)を取得。"""
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as c:
            rp = await c.get(
                f"https://www.instagram.com/reel/{shortcode}/",
                headers={"User-Agent": _UA, "Accept-Language": "ja,en;q=0.8"},
            )
            html = rp.text
            lm = _LSD_RE.search(html)
            if not lm:
                return None
            lsd = lm.group(1)
            cm = _CSRF_RE.search(html)
            csrf = cm.group(1) if cm else (c.cookies.get("csrftoken") or "")
            gr = await c.post(
                "https://www.instagram.com/graphql/query",
                headers={
                    "User-Agent": _UA,
                    "X-FB-LSD": lsd,
                    "X-IG-App-ID": _APPID,
                    "X-CSRFToken": csrf,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": f"https://www.instagram.com/reel/{shortcode}/",
                    "X-FB-Friendly-Name": "PolarisPostActionLoadPostQueryQuery",
                },
                data={"lsd": lsd, "doc_id": _DOC_ID, "variables": json.dumps({"shortcode": shortcode})},
            )
            if gr.status_code != 200:
                return None
            body = gr.text
            # 再生数(video_play_count / play_count) を最優先。無ければ視聴回数。
            for k in ("video_play_count", "play_count", "video_view_count", "view_count"):
                m = re.search(r'"%s":\s*(\d+)' % k, body)
                if m:
                    return int(m.group(1))
            return None
    except Exception:
        return None


async def _views_via_profile_api(handle: str, shortcode: str) -> int | None:
    """web_profile_info（ログアウト可・video_view_count=視聴回数。再生数より小さい）。"""
    h = handle.lstrip("@").strip()
    if not h:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(
                f"https://www.instagram.com/api/v1/users/web_profile_info/?username={h}",
                headers={"User-Agent": _UA, "x-ig-app-id": _APPID, "Accept-Language": "ja,en;q=0.8"},
            )
            if r.status_code != 200:
                return None
            user = ((r.json() or {}).get("data") or {}).get("user") or {}
            edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
            for e in edges:
                n = e.get("node") or {}
                if n.get("shortcode") == shortcode:
                    v = n.get("play_count")
                    if v is None:
                        v = n.get("video_view_count")
                    if v is None:
                        v = n.get("view_count")
                    return int(v) if v is not None else None
            return None
    except Exception:
        return None


async def scrape(context, video: TrackedVideo) -> ScrapeResult:
    shortcode = _shortcode(video)

    # 1) GraphQL: video_play_count(=表示される再生数) を取得（ログアウト可・正確）
    if shortcode:
        v = await _views_via_graphql(shortcode)
        if v is not None:
            return ScrapeResult(views=v, ok=True)

    # 2) web_profile_info（video_view_count=視聴回数の近似）
    if video.handle and shortcode:
        v = await _views_via_profile_api(video.handle, shortcode)
        if v is not None:
            return ScrapeResult(views=v, ok=True)

    # 3) ページ scrape フォールバック
    url = resolve_target_url(video)
    if not url:
        return ScrapeResult(views=None, ok=False, error="bad_url")
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        content = await page.content()
        for pat in _PLAYCOUNT_RES:
            m = pat.search(content)
            if m:
                views = parse_int(m.group(1))
                if views is not None:
                    return ScrapeResult(views=views, ok=True)
        final_url = page.url or ""
        if "/accounts/login" in final_url or "loginForm" in content or "Log in to Instagram" in content:
            return ScrapeResult(views=None, ok=False, error="login_required")
        return ScrapeResult(views=None, ok=False, error="no_playcount")
    except Exception as e:  # noqa: BLE001
        return ScrapeResult(views=None, ok=False, error=f"exception:{type(e).__name__}")
    finally:
        await page.close()
