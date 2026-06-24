// refresh-tokens — 期限が近いトークンを先回りリフレッシュ（pg_cron 毎時 / verify_jwt=false）
// TikTok は無告知で失効するため、期限切れ前に proactive リフレッシュする。
import { handleOptions, json, error } from "../_shared/cors.ts";
import {
  admin,
  audit,
  decryptAccountToken,
  persistAccountToken,
  type LinkedAccountRow,
} from "../_shared/supabase.ts";
import { getProvider } from "../_shared/providers/index.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    // 現在時刻から 2 時間先を cutoff に。これより前に切れる接続済みアカウントが対象。
    const cutoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const { data, error: queryError } = await admin()
      .from("linked_accounts")
      .select("id, platform, access_token_enc, refresh_token_enc, token_expires_at")
      .eq("status", "connected")
      .not("token_expires_at", "is", null)
      .lt("token_expires_at", cutoff);

    if (queryError) return error(queryError.message, 500);

    const rows = (data ?? []) as LinkedAccountRow[];
    const checked = rows.length;
    let refreshed = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const token = await decryptAccountToken(row, "refresh-tokens");
        const fresh = await getProvider(row.platform).refresh(token);
        await persistAccountToken(row.id, fresh);
        await audit(row.id, "refresh-tokens", "refresh");
        refreshed++;
      } catch (e) {
        await admin()
          .from("linked_accounts")
          .update({ status: "error", last_error: String(e) })
          .eq("id", row.id);
        failed++;
      }
    }

    return json({ checked, refreshed, failed });
  } catch (e) {
    return error(String(e), 500);
  }
});
