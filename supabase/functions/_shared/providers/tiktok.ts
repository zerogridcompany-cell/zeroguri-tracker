// _shared/providers/tiktok.ts — TikTok（無審査ルート: Login Kit + Display API Sandbox）
// Sandbox モードなら App Review なしで本人 OAuth が通る（テストアカウント数制限・SELF_ONLY）。
// 本人の OAuth トークンで video.query を叩き view_count を取得（linkMode=oauth）。
import { env, isSandbox } from "../env.ts";
import type { FetchContext, ProviderProfile, ProviderVideo, Token, ViewProvider } from "./types.ts";
import { sandboxFetchViews, sandboxListVideos, sandboxProfile } from "./sandbox.ts";

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE = "https://open.tiktokapis.com/v2/oauth/revoke/";
const API = "https://open.tiktokapis.com/v2";
const SCOPE = "user.info.basic,user.info.stats,video.list";

function expiresAt(sec: number): string {
  return new Date(Date.now() + sec * 1000).toISOString();
}

export const tiktokProvider: ViewProvider = {
  platform: "tiktok",
  linkMode: "oauth",

  // ───────── 計測: 本人 OAuth トークン（ctx.token）で video.query ─────────
  async fetchViews(ctx: FetchContext, contentIds: string[]): Promise<Map<string, number>> {
    if (isSandbox()) return sandboxFetchViews(contentIds);
    const token = ctx.token;
    if (!token) throw new Error("tiktok fetchViews: creator OAuth token required in ctx");
    const out = new Map<string, number>();
    for (let i = 0; i < contentIds.length; i += 20) {
      const batch = contentIds.slice(i, i + 20);
      const res = await fetch(`${API}/video/query/?fields=id,view_count`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: batch } }),
      });
      if (!res.ok) throw new Error(`tiktok video.query failed: ${await res.text()}`);
      const j = await res.json();
      for (const v of j.data?.videos ?? []) out.set(v.id, Number(v.view_count ?? 0));
    }
    return out;
  },

  // tiktok は oauth モードなので challenge の公開プロフィール取得は持たない。
  fetchPublicProfile(_identifier: string): Promise<ProviderProfile> {
    return Promise.reject(new Error("tiktok uses oauth link mode (sandbox), not challenge"));
  },

  // ───────── OAuth（Login Kit / Sandbox）─────────
  buildAuthorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_key: env("TIKTOK_CLIENT_KEY"),
      response_type: "code",
      scope: SCOPE,
      redirect_uri: env("TIKTOK_OAUTH_REDIRECT"),
      state,
    });
    return `${AUTH}?${p}`;
  },
  async exchangeCode(code: string): Promise<Token> {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: env("TIKTOK_OAUTH_REDIRECT"),
      }),
    });
    if (!res.ok) throw new Error(`tiktok token exchange failed: ${await res.text()}`);
    const j = await res.json();
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: expiresAt(j.expires_in) };
  },
  async refresh(token: Token): Promise<Token> {
    if (!token.refreshToken) throw new Error("tiktok: no refresh_token");
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`tiktok refresh failed: ${await res.text()}`);
    const j = await res.json();
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? token.refreshToken, expiresAt: expiresAt(j.expires_in) };
  },
  async revoke(token: Token): Promise<void> {
    await fetch(REVOKE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        token: token.accessToken,
      }),
    });
  },
  async fetchProfile(token: Token): Promise<ProviderProfile> {
    if (isSandbox()) return sandboxProfile("tiktok");
    const res = await fetch(`${API}/user/info/?fields=open_id,display_name,follower_count,video_count`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) throw new Error(`tiktok user.info failed: ${await res.text()}`);
    const j = await res.json();
    const u = j.data?.user;
    return {
      platformUserId: u?.open_id,
      handle: u?.display_name,
      followerCount: Number(u?.follower_count ?? 0),
      existingPostCount: Number(u?.video_count ?? 0),
    };
  },
  async listVideos(token: Token, opts?: { limit?: number }): Promise<ProviderVideo[]> {
    if (isSandbox()) return sandboxListVideos("tiktok", opts?.limit ?? 5);
    const res = await fetch(`${API}/video/list/?fields=id,title,view_count,share_url,create_time`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: opts?.limit ?? 20 }),
    });
    if (!res.ok) throw new Error(`tiktok video.list failed: ${await res.text()}`);
    const j = await res.json();
    return (j.data?.videos ?? []).map((v: Record<string, any>) => ({
      contentId: v.id,
      title: v.title,
      url: v.share_url,
      views: Number(v.view_count ?? 0),
      publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined,
    }));
  },
};
