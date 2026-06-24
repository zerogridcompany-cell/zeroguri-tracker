// oauth-callback — プロバイダのリダイレクトを受ける（verify_jwt=false）。
// ユーザー JWT は無い。identity は pending_oauth_states の state 行から復元する。
import { handleOptions, redirect } from "../_shared/cors.ts";
import { config } from "../_shared/env.ts";
import { admin, audit, persistAccountToken } from "../_shared/supabase.ts";
import { getProvider } from "../_shared/providers/index.ts";
import type { Platform } from "../_shared/providers/types.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const redirectBase = config.postOAuthRedirect();

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    // 1) プロバイダがエラーを返した / code・state 欠落 → 拒否
    if (oauthError || !code || !state) {
      return redirect(`${redirectBase}?error=oauth_denied`);
    }

    // 2) state 行を照合（CSRF 対策）。失効していれば無効扱い。
    const { data: stateRow, error: stateErr } = await admin()
      .from("pending_oauth_states")
      .select("state, user_id, platform, expires_at")
      .eq("state", state)
      .maybeSingle();

    const nowMs = Date.now();
    if (stateErr || !stateRow || new Date(stateRow.expires_at).getTime() < nowMs) {
      return redirect(`${redirectBase}?error=invalid_state`);
    }

    // ワンタイム消費：照合できたら即削除。
    await admin().from("pending_oauth_states").delete().eq("state", state);

    const platform = stateRow.platform as Platform;
    const userId = stateRow.user_id as string;
    const provider = getProvider(platform);

    // 3) 認可コード → トークン → プロフィール
    const token = await provider.exchangeCode(code);
    const profile = await provider.fetchProfile(token);

    // 4) 新規アカウント判定：投稿ゼロ、または作成から 30 日以内。
    const createdMs = profile.accountCreatedAt
      ? new Date(profile.accountCreatedAt).getTime()
      : null;
    const isNew = profile.existingPostCount === 0 ||
      (createdMs !== null && nowMs - createdMs <= THIRTY_DAYS_MS);

    // 5) linked_accounts を upsert（(platform, platform_user_id) で一意）
    const nowIso = new Date().toISOString();
    const { data: account, error: upsertErr } = await admin()
      .from("linked_accounts")
      .upsert(
        {
          user_id: userId,
          platform,
          platform_user_id: profile.platformUserId,
          handle: profile.handle,
          account_created_at: profile.accountCreatedAt,
          follower_count: profile.followerCount,
          existing_post_count: profile.existingPostCount,
          is_new_account: isNew,
          status: "connected",
          ownership_method: "oauth",
          ownership_verified_at: nowIso,
          connected_at: nowIso,
        },
        { onConflict: "platform,platform_user_id" },
      )
      .select()
      .single();

    if (upsertErr || !account) {
      return redirect(`${redirectBase}?error=link_failed`);
    }

    // 6) トークンを暗号化して保存し、監査ログを残す。
    await persistAccountToken(account.id, token);
    await audit(account.id, "oauth-callback", "read", { platform });

    // 7) 完了：アプリ側へ戻す。
    return redirect(`${redirectBase}?linked=${platform}`);
  } catch (_e) {
    return redirect(`${redirectBase}?error=link_failed`);
  }
});
