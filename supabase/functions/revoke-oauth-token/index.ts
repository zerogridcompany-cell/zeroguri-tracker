// revoke-oauth-token/index.ts — リンク済みアカウントの OAuth トークンを失効（verify_jwt=true）
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, audit, decryptAccountToken, getUser, type LinkedAccountRow } from "../_shared/supabase.ts";
import { getProvider } from "../_shared/providers/index.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const { linked_account_id } = await req.json().catch(() => ({}));
    if (!linked_account_id) return error("linked_account_id required", 400);

    const { data: row, error: selErr } = await admin()
      .from("linked_accounts")
      .select("id,user_id,platform,access_token_enc,refresh_token_enc,token_expires_at")
      .eq("id", linked_account_id)
      .maybeSingle();

    if (selErr) return error(selErr.message, 500);
    if (!row || row.user_id !== user.id) return error("forbidden", 403);

    // ベストエフォートで provider 側のトークンも失効
    const token = await decryptAccountToken(row as LinkedAccountRow, "revoke-oauth-token");
    try {
      await getProvider(row.platform).revoke(token);
    } catch {
      // provider 側の失効に失敗しても、ローカルの失効処理は継続する
    }

    const nowIso = new Date().toISOString();

    await admin()
      .from("linked_accounts")
      .update({
        status: "revoked",
        access_token_enc: null,
        refresh_token_enc: null,
        token_expires_at: null,
      })
      .eq("id", row.id);

    await admin()
      .from("tracked_videos")
      .update({
        status: "retired",
        retired_reason: "revoked",
        retired_at: nowIso,
      })
      .eq("linked_account_id", row.id)
      .eq("status", "active");

    await audit(row.id, "revoke-oauth-token", "revoke");

    return json({ ok: true });
  } catch (e) {
    return error(String(e), 500);
  }
});
