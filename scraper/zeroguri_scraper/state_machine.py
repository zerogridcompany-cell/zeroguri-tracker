"""tracking-tick の state machine を Python に移植（Deno 版と一致させる）。

cap retire / stall retire / 伸び連動 backoff / billing-integrity（peak / drop / spike）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from .models import TrackedVideo

CHECK_INTERVAL = timedelta(minutes=30)  # 各動画は30分ごとに再スクレイプ


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def compute_update(
    video: TrackedVideo,
    current: Optional[int],
    now: Optional[datetime] = None,
) -> tuple[dict, Optional[dict]]:
    """(tracked_videos に書く更新dict, view_snapshots dict or None) を返す。"""
    now = now or datetime.now(timezone.utc)
    now_iso = _iso(now)

    # 取得失敗 → error_count++、3連続で expired retire。スナップショットは残さない。
    if current is None:
        error_count = video.error_count + 1
        upd: dict = {"error_count": error_count, "last_checked_at": now_iso}
        if error_count >= 3:
            upd.update(status="retired", retired_reason="expired", retired_at=now_iso)
        return upd, None

    attributable = max(0, current - video.baseline_views)
    peak = max(video.peak_views, attributable)
    drop_delta = video.last_views - attributable
    rise_delta = attributable - video.last_views

    anomaly: Optional[str] = None
    if drop_delta >= max(100, video.cap * 0.01):
        anomaly = "drop"          # 再生数が有意に減少（スパム除去/クローバック）
    elif video.last_views > 0 and rise_delta >= video.cap * 0.5:
        anomaly = "spike"         # 1サイクルで cap の半分以上急増 = viewbot 疑い

    upd = {
        "last_views": attributable,
        "peak_views": peak,
        "anomaly_flag": anomaly,
        "last_checked_at": now_iso,
    }

    if attributable >= video.cap:
        # cap 到達で計測終了
        upd.update(status="retired", retired_reason="cap", retired_at=now_iso)
    else:
        # それ以外は30分ごとに再スクレイプ（伸び停止でも引退しない）。
        # spike(viewbot疑い)は anomaly_flag に記録するが cadence は同じ30分。
        upd.update(
            next_check_at=_iso(now + CHECK_INTERVAL),
            check_interval="30 minutes",
            stall_count=0,
            error_count=0,
        )

    snapshot = {"views": attributable, "raw_views": current}
    return upd, snapshot
