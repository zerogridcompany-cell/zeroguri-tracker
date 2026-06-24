// youtube-oauth-url — OAuth 認可 URL を発行（state を pending_oauth_states に保存）
import { error, handleOptions, json } from "../_shared/cors.ts";
import { randomState } from "../_shared/crypto.ts";
import { getProvider } from "../_shared/providers/index.ts";
import { admin, getUser } from "../_shared/supabase.ts";

const platform = "youtube" as const;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== "POST" && req.method !== "GET") return error("method", 405);

  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const state = randomState();
    const { error: insErr } = await admin()
      .from("pending_oauth_states")
      .insert({ state, user_id: user.id, platform });
    if (insErr) return error(insErr.message, 500);

    const authorize_url = getProvider(platform).buildAuthorizeUrl(state);
    return json({ authorize_url, state });
  } catch (e) {
    return error(String(e), 500);
  }
});
