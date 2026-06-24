// unlink-account — アカウント連携の解除（verify_jwt=true / 本人専用）
// クライアントの RLS DELETE が無音で 0 行になる事故を避けるため、本人確認のうえ
// service_role で確実に削除する。FK ON DELETE CASCADE で計測動画・集計も連動削除。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, audit, getUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const id = (body.id as string)?.trim();
    if (!id) return error("id required", 400);

    const db = admin();
    const { data: acct } = await db
      .from("linked_accounts")
      .select("id, user_id, platform, handle")
      .eq("id", id)
      .maybeSingle();
    if (!acct) return error("アカウントが見つかりません", 404);
    if (acct.user_id !== user.id) return error("forbidden", 403);

    await audit(id, "unlink-account", "revoke", { platform: acct.platform });
    const { error: delErr } = await db.from("linked_accounts").delete().eq("id", id);
    if (delErr) return error(delErr.message, 500);

    return json({ ok: true });
  } catch (e) {
    return error(String(e), 500);
  }
});
