"""環境変数からの設定ロード。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str
    poll_interval: int          # 秒。1サイクルごとの待機
    batch_limit: int            # 1サイクルで claim する最大本数
    headless: bool
    proxy_url: str | None       # http://user:pass@host:port 形式（任意）
    ig_session_cookie: str | None  # Instagram の sessionid cookie（ログイン要のため）
    nav_timeout_ms: int
    user_agent: str


def _bool(v: str | None, default: bool) -> bool:
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def load_settings() -> Settings:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は必須です")
    return Settings(
        supabase_url=url,
        service_key=key,
        poll_interval=int(os.environ.get("POLL_INTERVAL_SEC", "600")),
        batch_limit=int(os.environ.get("BATCH_LIMIT", "200")),
        headless=_bool(os.environ.get("HEADLESS"), True),
        proxy_url=os.environ.get("PROXY_URL") or None,
        ig_session_cookie=os.environ.get("IG_SESSION_COOKIE") or None,
        nav_timeout_ms=int(os.environ.get("NAV_TIMEOUT_MS", "20000")),
        user_agent=os.environ.get(
            "USER_AGENT",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ),
    )


def proxy_dict(settings: Settings) -> dict | None:
    """PROXY_URL を Playwright の proxy 引数形式に変換。"""
    if not settings.proxy_url:
        return None
    p = urlparse(settings.proxy_url)
    server = f"{p.scheme}://{p.hostname}"
    if p.port:
        server += f":{p.port}"
    out: dict = {"server": server}
    if p.username:
        out["username"] = p.username
    if p.password:
        out["password"] = p.password
    return out
