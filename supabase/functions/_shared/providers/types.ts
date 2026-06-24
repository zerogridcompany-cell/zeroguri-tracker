// _shared/providers/types.ts — Provider 抽象（無審査ルート対応）
// 取得の認証モデルがプラットフォームで異なる:
//   youtube   : サーバ API KEY（per-creator トークン不要・公開統計）          linkMode=challenge
//   instagram : サーバ Business Discovery トークン + creator handle（Reels view）linkMode=challenge
//   tiktok    : per-creator OAuth トークン（Login Kit + Display Sandbox）        linkMode=oauth

export type Platform = "youtube" | "tiktok" | "instagram";

export type LinkMode = "challenge" | "oauth";

export interface Token {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO8601
}

/** fetchViews に渡す取得コンテキスト。プラットフォームごとに使う項目が違う。 */
export interface FetchContext {
  token?: Token;          // tiktok: creator OAuth トークン
  handle?: string | null; // instagram: business_discovery 対象の username
}

export interface ProviderProfile {
  platformUserId: string;       // channel_id / open_id / ig_user_id
  handle?: string;
  accountCreatedAt?: string;    // ISO8601（新規判定に使用）
  followerCount?: number;
  existingPostCount?: number;
  bioText?: string;             // チャレンジコード照合用（channel description / IG biography）
}

export interface ProviderVideo {
  contentId: string;
  title?: string;
  url?: string;
  views?: number;
  publishedAt?: string;
}

export interface ViewProvider {
  platform: Platform;
  /** challenge = bio/概要欄コードで所有確認（OAuth不要） / oauth = 本人ログインで所有確認 */
  linkMode: LinkMode;

  // ── 計測（無審査ルート）──
  /** contentId 配列 → 再生数 Map。youtube=APIキー / instagram=Business Discovery(ctx.handle) / tiktok=ctx.token。 */
  fetchViews(ctx: FetchContext, contentIds: string[]): Promise<Map<string, number>>;

  // ── 所有確認（challenge モード）──
  /** 公開プロフィールを identifier（YT: @handle or channelId / IG: username）から取得。bioText にコードを含む。 */
  fetchPublicProfile(identifier: string): Promise<ProviderProfile>;

  // ── OAuth（oauth モード = tiktok のみ実体を持つ）──
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<Token>;
  refresh(token: Token): Promise<Token>;
  revoke(token: Token): Promise<void>;
  fetchProfile(token: Token): Promise<ProviderProfile>;
  listVideos(token: Token, opts?: { limit?: number }): Promise<ProviderVideo[]>;
}
