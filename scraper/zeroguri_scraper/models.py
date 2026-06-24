"""データモデル。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class TrackedVideo:
    """claim_due_tracked_videos が返す tracked_videos 行（必要列のみ）。"""
    id: str
    platform: str            # youtube | tiktok | instagram
    content_id: str
    url: Optional[str]
    cap: int
    baseline_views: int
    last_views: int
    peak_views: int
    stall_count: int
    error_count: int
    linked_account_id: Optional[str] = None
    handle: Optional[str] = None  # 連携アカウントの @handle（claim 後に補完。IG の再生数API で使用）

    @classmethod
    def from_row(cls, r: dict) -> "TrackedVideo":
        return cls(
            id=r["id"],
            platform=r["platform"],
            content_id=r["content_id"],
            url=r.get("url"),
            cap=int(r.get("cap") or 0),
            baseline_views=int(r.get("baseline_views") or 0),
            last_views=int(r.get("last_views") or 0),
            peak_views=int(r.get("peak_views") or 0),
            stall_count=int(r.get("stall_count") or 0),
            error_count=int(r.get("error_count") or 0),
            linked_account_id=r.get("linked_account_id"),
        )


@dataclass
class ScrapeResult:
    """スクレイプ結果。views=None は取得失敗。"""
    views: Optional[int]
    ok: bool
    error: Optional[str] = None
