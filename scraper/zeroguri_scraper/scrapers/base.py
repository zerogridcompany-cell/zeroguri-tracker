"""スクレイパの共通契約とレジストリ。

各プラットフォームモジュール（youtube/tiktok/instagram）は
    async def scrape(context, video) -> ScrapeResult
を公開する。context は Playwright の BrowserContext、video は TrackedVideo。
"""
from __future__ import annotations

import re
from importlib import import_module
from typing import Awaitable, Callable

from ..models import ScrapeResult, TrackedVideo

ScrapeFn = Callable[[object, TrackedVideo], Awaitable[ScrapeResult]]

_SUPPORTED = {"youtube", "tiktok", "instagram"}


def get_scraper(platform: str) -> ScrapeFn:
    if platform not in _SUPPORTED:
        raise ValueError(f"unsupported platform: {platform}")
    mod = import_module(f"zeroguri_scraper.scrapers.{platform}")
    return mod.scrape  # type: ignore[attr-defined]


_INT_RE = re.compile(r"[\d,]+")


def parse_int(value) -> int | None:
    """'1,234,567' / '1.2M' / 12345 などを int に。失敗時 None。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip()
    m = re.fullmatch(r"\s*([\d.]+)\s*([KkMmBb万億])?\s*", s)
    if m:
        num = float(m.group(1))
        unit = (m.group(2) or "").lower()
        mult = {"k": 1e3, "m": 1e6, "b": 1e9, "万": 1e4, "億": 1e8}.get(unit, 1)
        return int(num * mult)
    digits = _INT_RE.search(s)
    if digits:
        try:
            return int(digits.group(0).replace(",", ""))
        except ValueError:
            return None
    return None


# ── URL 解決 ─────────────────────────────────────────────
# content_id が「素のID」でも「フルURL（?si= 等の付与あり）」でも、
# 各プラットフォームの正しいスクレイプ用 URL を組み立てる。
_YT_ID = re.compile(r"(?:v=|/shorts/|/embed/|/live/|youtu\.be/)([0-9A-Za-z_-]{11})")
_YT_BARE = re.compile(r"^[0-9A-Za-z_-]{11}$")
_IG_CODE = re.compile(r"/(?:reels?|p|tv)/([0-9A-Za-z_-]+)")
_IG_BARE = re.compile(r"^[0-9A-Za-z_-]{5,}$")


def _candidates(video) -> list[str]:
    out: list[str] = []
    for v in (getattr(video, "url", None), getattr(video, "content_id", None)):
        if v and str(v).strip():
            out.append(str(v).strip())
    return out


def resolve_target_url(video) -> str | None:
    """video.url / video.content_id から正しいスクレイプ URL を返す。組めなければ None。"""
    plat = video.platform
    cands = _candidates(video)

    if plat == "youtube":
        for c in cands:
            m = _YT_ID.search(c)
            if m:
                return f"https://www.youtube.com/watch?v={m.group(1)}"
            if _YT_BARE.match(c):
                return f"https://www.youtube.com/watch?v={c}"
        return None

    if plat == "tiktok":
        for c in cands:
            if c.startswith("http"):
                return c.split("?", 1)[0]  # トラッキングパラメータを除去
        # content_id が素の数値動画ID のみ → canonical を組む（@i は正しいユーザーへ転送される）
        for c in cands:
            if re.fullmatch(r"\d{6,25}", c):
                return f"https://www.tiktok.com/@i/video/{c}"
        return None

    if plat == "instagram":
        for c in cands:
            m = _IG_CODE.search(c)
            if m:
                return f"https://www.instagram.com/reel/{m.group(1)}/"
        for c in cands:
            if not c.startswith("http") and _IG_BARE.match(c):
                return f"https://www.instagram.com/reel/{c}/"
        return None

    return None
