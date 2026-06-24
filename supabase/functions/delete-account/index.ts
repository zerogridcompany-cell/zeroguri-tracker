// delete-account — 自分のアカウントを完全削除（verify_jwt=true）
// auth.users を削除 → app_users(on delete cascade) → profiles/linked_accounts/campaigns/tracked_videos まで連鎖削除。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const { error: delErr } = await admin().auth.admin.deleteUser(user.id);
    if (delErr) return error(delErr.message, 500);
    return json({ ok: true });
  } catch (e) {
    return error(String(e), 500);
  }
});
