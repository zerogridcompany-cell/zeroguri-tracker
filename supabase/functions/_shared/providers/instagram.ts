// _shared/providers/instagram.ts — Instagram（無審査ルート: Business Discovery / Dev Mode）
// 自分の Meta App を Development Mode のまま、自分のIGプロアカ(IG_BUSINESS_USER_ID) + 長期トークンで
// business_discovery.username(CREATOR){media{view_count}} を叩き、任意の公開プロアカの Reels 再生数を読む。
// App Review 不要。view_count は Reels の再生(有料+オーガニック)で Business Discovery 経由のみ露出。
// 所有確認は biography 内のチャレンジコードを照合（OAuth不要）。
import { env, isSandbox } from "../env.ts";
import type { FetchContext, ProviderProfile, ProviderVideo, Token, ViewProvider } from "./types.ts";
import { sandboxFetchViews, sandboxListVideos, sandboxProfile } from "./sandbox.ts";

const GRAPH = "https://graph.facebook.com/v22.0";

function bizContext(): { igUserId: string; token: string } {
  const igUserId = env("IG_BUSINESS_USER_ID");
  const token = env("IG_BUSINESS_DISCOVERY_TOKEN");
  if (!igUserId || !token) {
    throw new Error("IG_BUSINESS_USER_ID / IG_BUSINESS_DISCOVERY_TOKEN are not set");
  }
  return { igUserId, token };
}

/** business_discovery で対象 username のフィールドを引く共通関数。 */
async function businessDiscovery(username: string, mediaFields: string): Promise<Record<string, any>> {
  const { igUserId, token } = bizContext();
  const fields = `business_discovery.username(${username}){${mediaFields}}`;
  const res = await fetch(
    `${GRAPH}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${token}`,
  );
  if (!res.ok) throw new Error(`instagram business_discovery failed: ${await res.text()}`);
  const j = await res.json();
  return j.business_discovery ?? {};
}

export const instagramProvider: ViewProvider = {
  platform: "instagram",
  linkMode: "challenge",

  // ───────── 無審査: Business Discovery で Reels view_count ─────────
  async fetchViews(ctx: FetchContext, contentIds: string[]): Promise<Map<string, number>> {
    if (isSandbox()) return sandboxFetchViews(contentIds);
    const username = ctx.handle?.replace(/^@/, "");
    if (!username) throw new Error("instagram fetchViews: handle (username) required in ctx");
    const wanted = new Set(contentIds);
    const out = new Map<string, number>();
    // 対象クリエイターの最近メディアを取得し、追跡中の content_id だけ拾う。
    const bd = await businessDiscovery(username, "media{id,media_product_type,view_count}");
    for (const m of bd.media?.data ?? []) {
      if (wanted.has(m.id)) out.set(m.id, Number(m.view_count ?? 0));
    }
    return out;
  },

  // ───────── 所有確認: biography 内のコードを照合 ─────────
  async fetchPublicProfile(identifier: string): Promise<ProviderProfile> {
    if (isSandbox()) return sandboxProfile("instagram", identifier);
    const username = identifier.replace(/^@/, "");
    const bd = await businessDiscovery(
      username,
      "id,username,name,biography,followers_count,media_count",
    );
    return {
      platformUserId: String(bd.id ?? username),
      handle: bd.username ?? username,
      followerCount: Number(bd.followers_count ?? 0),
      existingPostCount: Number(bd.media_count ?? 0),
      bioText: bd.biography ?? "",
    };
  },

  // ───────── OAuth（無審査ルートでは未使用。将来 owner insights 用に温存）─────────
  buildAuthorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: env("INSTAGRAM_APP_ID"),
      redirect_uri: env("INSTAGRAM_OAUTH_REDIRECT"),
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_insights",
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  },
  async exchangeCode(code: string): Promise<Token> {
    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("INSTAGRAM_APP_ID"),
        client_secret: env("INSTAGRAM_APP_SECRET"),
        grant_type: "authorization_code",
        redirect_uri: env("INSTAGRAM_OAUTH_REDIRECT"),
        code,
      }),
    });
    if (!res.ok) throw new Error(`instagram code exchange failed: ${await res.text()}`);
    const j = await res.json();
    return {
      accessToken: j.access_token,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  },
  async refresh(token: Token): Promise<Token> {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token.accessToken}`,
    );
    if (!res.ok) throw new Error(`instagram refresh failed: ${await res.text()}`);
    const j = await res.json();
    return {
      accessToken: j.access_token,
      expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    };
  },
  async revoke(_token: Token): Promise<void> {
    return; // IG は明示 revoke が弱い → 保存トークン破棄で対応
  },
  async fetchProfile(token: Token): Promise<ProviderProfile> {
    if (isSandbox()) return sandboxProfile("instagram");
    const res = await fetch(
      `https://graph.instagram.com/me?fields=id,username,media_count,followers_count&access_token=${token.accessToken}`,
    );
    if (!res.ok) throw new Error(`instagram me failed: ${await res.text()}`);
    const j = await res.json();
    return {
      platformUserId: j.id,
      handle: j.username,
      followerCount: Number(j.followers_count ?? 0),
      existingPostCount: Number(j.media_count ?? 0),
    };
  },
  async listVideos(_token: Token, opts?: { limit?: number }): Promise<ProviderVideo[]> {
    if (isSandbox()) return sandboxListVideos("instagram", opts?.limit ?? 5);
    return []; // Business Discovery ルートでは listVideos は未使用
  },
};
