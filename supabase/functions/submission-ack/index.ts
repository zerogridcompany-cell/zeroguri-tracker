// submission-ack — 本人が却下通知を確認済みにする（verify_jwt=true）
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const body = await req.json().catch(() => ({}));
    const id = (body.id as string)?.trim();
    if (!id) return error("id required", 400);
    const { error: e } = await admin()
      .from("video_submissions")
      .update({ seen_by_user: true })
      .eq("id", id).eq("user_id", user.id);
    if (e) return error(e.message, 500);
    return json({ ok: true });
  } catch (e) {
    return error(String(e), 500);
  }
});
