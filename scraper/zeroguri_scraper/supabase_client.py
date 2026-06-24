"""Supabase REST (PostgREST) クライアント（service_role）。"""
from __future__ import annotations

from typing import Optional

import httpx

from .config import Settings
from .models import TrackedVideo


class SupabaseClient:
    def __init__(self, settings: Settings):
        self._base = settings.supabase_url
        self._headers = {
            "apikey": settings.service_key,
            "Authorization": f"Bearer {settings.service_key}",
            "Content-Type": "application/json",
        }
        self._http = httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def claim_due(self, limit: int) -> list[TrackedVideo]:
        """部分インデックス + SKIP LOCKED で due な active 動画を claim。"""
        r = await self._http.post(
            f"{self._base}/rest/v1/rpc/claim_due_tracked_videos",
            headers=self._headers,
            json={"p_limit": limit},
        )
        r.raise_for_status()
        rows = r.json() or []
        videos = [TrackedVideo.from_row(row) for row in rows]
        await self._attach_handles(videos)
        return videos

    async def _attach_handles(self, videos: list[TrackedVideo]) -> None:
        """連携アカウントの @handle を補完（IG の web_profile_info で投稿者一覧を引くのに必要）。"""
        ids = list({v.linked_account_id for v in videos if v.linked_account_id})
        if not ids:
            return
        try:
            r = await self._http.get(
                f"{self._base}/rest/v1/linked_accounts",
                headers=self._headers,
                params={"id": f"in.({','.join(ids)})", "select": "id,handle"},
            )
            if r.status_code != 200:
                return
            hmap = {row["id"]: row.get("handle") for row in (r.json() or [])}
            for v in videos:
                if v.linked_account_id:
                    v.handle = hmap.get(v.linked_account_id)
        except Exception:
            pass

    async def update_video(self, video_id: str, fields: dict) -> None:
        r = await self._http.patch(
            f"{self._base}/rest/v1/tracked_videos",
            headers={**self._headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{video_id}"},
            json=fields,
        )
        r.raise_for_status()

    async def insert_snapshot(self, video_id: str, views: int, raw_views: int) -> None:
        r = await self._http.post(
            f"{self._base}/rest/v1/view_snapshots",
            headers={**self._headers, "Prefer": "return=minimal"},
            json={"tracked_video_id": video_id, "views": views, "raw_views": raw_views},
        )
        # 同一秒の重複 PK 衝突は無視（409）。
        if r.status_code not in (201, 204, 409):
            r.raise_for_status()

    async def mark_account_error(self, linked_account_id: str, message: str) -> None:
        await self._http.patch(
            f"{self._base}/rest/v1/linked_accounts",
            headers={**self._headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{linked_account_id}"},
            json={"status": "error", "last_error": message[:500]},
        )
