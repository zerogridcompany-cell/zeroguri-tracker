// _shared/providers/youtube.ts — YouTube（無審査ルート: API KEY のみ）
// 公開統計は OAuth 不要。videos.list?part=statistics&id=...&key=API_KEY を 50本/コール（1ユニット）でバッチ。
// 所有確認は channels.list?forHandle で description を読み、チャレンジコードを照合（OAuth不要）。
import { env, isSandbox } from "../env.ts";
import type { FetchContext, ProviderProfile, ProviderVideo, Token, ViewProvider } from "./types.ts";
import { sandboxFetchViews, sandboxListVideos, sandboxProfile } from "./sandbox.ts";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function apiKey(): string {
  const k = env("YOUTUBE_API_KEY");
  if (!k) throw new Error("YOUTUBE_API_KEY is not set");
  return k;
}

export const youtubeProvider: ViewProvider = {
  platform: "youtube",
  linkMode: "challenge",

  // ───────── 無審査: 公開統計（API KEY のみ）─────────
  async fetchViews(_ctx: FetchContext, contentIds: string[]): Promise<Map<string, number>> {
    if (isSandbox()) return sandboxFetchViews(contentIds);
    const key = apiKey();
    const out = new Map<string, number>();
    for (let i = 0; i < contentIds.length; i += 50) {
      const batch = contentIds.slice(i, i + 50);
      const res = await fetch(`${API}/videos?part=statistics&id=${batch.join(",")}&key=${key}`);
      if (!res.ok) throw new Error(`youtube videos.list failed: ${await res.text()}`);
      const j = await res.json();
      for (const it of j.items ?? []) out.set(it.id, Number(it.statistics?.viewCount ?? 0));
    }
    return out;
  },

  // ───────── 所有確認: チャンネル概要欄のコードを API KEY で読む ─────────
  async fetchPublicProfile(identifier: string): Promise<ProviderProfile> {
    if (isSandbox()) return sandboxProfile("youtube", identifier);
    const key = apiKey();
    // identifier が @handle ならば forHandle、それ以外は channel id とみなす。
    const sel = identifier.startsWith("@")
      ? `forHandle=${encodeURIComponent(identifier)}`
      : `id=${encodeURIComponent(identifier)}`;
    const res = await fetch(
      `${API}/channels?part=snippet,statistics&${sel}&key=${key}`,
    );
    if (!res.ok) throw new Error(`youtube channels.list failed: ${await res.text()}`);
    const j = await res.json();
    const ch = j.items?.[0];
    if (!ch) throw new Error("youtube: channel not found for identifier");
    return {
      platformUserId: ch.id,
      handle: ch.snippet?.customUrl ?? identifier,
      accountCreatedAt: ch.snippet?.publishedAt,
      followerCount: Number(ch.statistics?.subscriberCount ?? 0),
      existingPostCount: Number(ch.statistics?.videoCount ?? 0),
      bioText: ch.snippet?.description ?? "",
    };
  },

  // ───────── OAuth（無審査ルートでは未使用。将来 readonly 連携用に温存）─────────
  buildAuthorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: env("GOOGLE_OAUTH_REDIRECT"),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `${AUTH}?${p}`;
  },
  async exchangeCode(code: string): Promise<Token> {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: env("GOOGLE_OAUTH_REDIRECT"),
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) throw new Error(`youtube token exchange failed: ${await res.text()}`);
    const j = await res.json();
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    };
  },
  async refresh(token: Token): Promise<Token> {
    if (!token.refreshToken) throw new Error("youtube: no refresh_token");
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: token.refreshToken,
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`youtube refresh failed: ${await res.text()}`);
    const j = await res.json();
    return {
      accessToken: j.access_token,
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    };
  },
  async revoke(token: Token): Promise<void> {
    await fetch(`${REVOKE}?token=${encodeURIComponent(token.accessToken)}`, { method: "POST" });
  },
  async fetchProfile(token: Token): Promise<ProviderProfile> {
    if (isSandbox()) return sandboxProfile("youtube");
    const res = await fetch(`${API}/channels?part=id,snippet,statistics&mine=true`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) throw new Error(`youtube channels.list failed: ${await res.text()}`);
    const j = await res.json();
    const ch = j.items?.[0];
    if (!ch) throw new Error("youtube: no channel for this account");
    return {
      platformUserId: ch.id,
      handle: ch.snippet?.customUrl ?? ch.snippet?.title,
      accountCreatedAt: ch.snippet?.publishedAt,
      followerCount: Number(ch.statistics?.subscriberCount ?? 0),
      existingPostCount: Number(ch.statistics?.videoCount ?? 0),
    };
  },
  async listVideos(token: Token, opts?: { limit?: number }): Promise<ProviderVideo[]> {
    if (isSandbox()) return sandboxListVideos("youtube", opts?.limit ?? 5);
    const chRes = await fetch(`${API}/channels?part=contentDetails&mine=true`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    const ch = await chRes.json();
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const plRes = await fetch(
      `${API}/playlistItems?part=snippet,contentDetails&maxResults=${opts?.limit ?? 25}&playlistId=${uploads}`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );
    const pl = await plRes.json();
    return (pl.items ?? []).map((it: Record<string, any>) => ({
      contentId: it.contentDetails?.videoId,
      title: it.snippet?.title,
      url: `https://youtube.com/watch?v=${it.contentDetails?.videoId}`,
      publishedAt: it.contentDetails?.videoPublishedAt,
    }));
  },
};
