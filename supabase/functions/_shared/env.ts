// _shared/env.ts — 環境変数アクセス（Deno）

export function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

export function isSandbox(): boolean {
  return (Deno.env.get("TRACKER_SANDBOX") ?? "true").toLowerCase() === "true";
}

export const config = {
  supabaseUrl: () => env("SUPABASE_URL", "http://127.0.0.1:54321"),
  serviceRoleKey: () => env("SUPABASE_SERVICE_ROLE_KEY"),
  anonKey: () => env("SUPABASE_ANON_KEY"),
  tokenEncKey: () => env("TOKEN_ENC_KEY"),
  defaultCap: () => parseInt(env("DEFAULT_CAP", "500000"), 10),
  defaultUnitPrice: () => parseFloat(env("DEFAULT_UNIT_PRICE", "0.1")),
  batchLimit: () => parseInt(env("TRACKING_BATCH_LIMIT", "500"), 10),
  postOAuthRedirect: () => env("APP_POST_OAUTH_REDIRECT", "http://localhost:3000/dashboard"),
  // 無審査ルート
  youtubeApiKey: () => env("YOUTUBE_API_KEY"),
  igBusinessUserId: () => env("IG_BUSINESS_USER_ID"),
  igBusinessToken: () => env("IG_BUSINESS_DISCOVERY_TOKEN"),
};
