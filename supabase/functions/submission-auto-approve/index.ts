// submission-auto-approve — 自動承認（verify_jwt=false / 内部）。
// org_settings.auto_approve が ON のときだけ、提出（グループ）をそのまま承認する。
// 提出直後にクライアントから呼ばれる。auto_approve のサーバ判定でゲートするので、OFF のときは何もしない。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin } from "../_shared/supabase.ts";
import { processGroupApproval } from "../_shared/approve-core.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const b = await req.json().catch(() => ({}));
    const id = (b.submission_id as string)?.trim();
    if (!id) return error("submission_id required", 400);

    const db = admin();
    const { data: setting } = await db.from("org_settings").select("auto_approve").eq("id", 1).maybeSingle();
    if (!setting?.auto_approve) return json({ ok: true, skipped: "auto_approve off" });

    const { data: sub } = await db.from("video_submissions").select("*").eq("id", id).maybeSingle();
    if (!sub) return json({ ok: true, skipped: "no submission" });
    if ((sub.status as string) !== "pending") return json({ ok: true, skipped: "not pending" });

    const caption = (sub.caption as string | null) ?? "";
    const r = await processGroupApproval(db, sub, caption, null); // actorId=null → 自動承認
    return json({ ok: true, auto: true, approved: r.approved, posted: r.posted, ...(r.errs.length ? { failed: r.errs } : {}) });
  } catch (e) {
    return error(String(e), 500);
  }
});
