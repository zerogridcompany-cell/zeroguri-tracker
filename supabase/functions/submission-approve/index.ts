// submission-approve — 提出の承認/却下/削除＋自動承認トグル（verify_jwt=true / オーガナイザー専用）
// 承認処理の中核は _shared/approve-core.ts（submission-auto-approve と共用）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser, likeExact } from "../_shared/supabase.ts";
import { processGroupApproval } from "../_shared/approve-core.ts";

type Sub = Record<string, unknown>;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", likeExact(user.email ?? "___none___")).maybeSingle();
    if (!org) return error("forbidden", 403);

    const b = await req.json().catch(() => ({}));
    const action = b.action as string;

    // ───────── 自動承認トグル ─────────
    if (action === "set_auto_approve") {
      const value = Boolean(b.value);
      await db.from("org_settings").update({ auto_approve: value, updated_at: new Date().toISOString() }).eq("id", 1);
      return json({ ok: true, auto_approve: value });
    }

    const id = (b.id as string)?.trim();
    if (!id || !["approve", "reject", "delete"].includes(action)) return error("id and action required", 400);

    const { data: sub } = await db.from("video_submissions").select("*").eq("id", id).maybeSingle();
    if (!sub) return error("submission not found", 404);

    const nowIso = new Date().toISOString();
    const groupId = (sub.group_id as string | null) ?? null;
    const subUserId = sub.user_id as string;
    const logAudit = (subId: string, act: string, reason: string | null) =>
      db.from("submission_audit_log").insert({ submission_id: subId, action: act, actor_id: user.id, reason });

    // ───────── 削除 ─────────（処理済みカードは1件ずつ表示されるので、クリックした1件だけ）
    if (action === "delete") {
      await db.from("video_submissions").delete().eq("id", id);
      return json({ ok: true, status: "deleted" });
    }

    // ───────── 却下 ─────────（グループ全体を却下）
    if (action === "reject") {
      const reason = ((b.reason as string) ?? "").trim() || null;
      const targets: Sub[] = groupId
        ? ((await db.from("video_submissions").select("id").eq("group_id", groupId).eq("user_id", subUserId).eq("status", "pending")).data ?? [])
        : [sub];
      let n = 0;
      for (const t of targets) {
        const { data: rej } = await db.from("video_submissions").update({
          status: "rejected", reviewed_by: user.id, reviewed_at: nowIso, reject_reason: reason, seen_by_user: false,
        }).eq("id", t.id as string).eq("status", "pending").select("id");
        if (rej && rej.length) { n++; await logAudit(t.id as string, "rejected", reason); }
      }
      if (n === 0) return error("この提出は既に処理済みです", 409);
      return json({ ok: true, status: "rejected", count: n });
    }

    // ───────── 承認 ─────────（グループまとめて。中核は共通モジュール）
    const caption = (b.caption as string | undefined) ?? (sub.caption as string | null) ?? "";
    const r = await processGroupApproval(db, sub, caption, user.id);
    if (!r.ok) return error(r.error ?? "承認に失敗しました", r.conflict ? 409 : 400);
    return json({
      ok: true, status: "approved", approved: r.approved, posted: r.posted,
      ...(r.ambiguous ? { ambiguous: r.ambiguous } : {}), ...(r.errs.length ? { failed: r.errs } : {}),
    });
  } catch (e) {
    return error(String(e), 500);
  }
});
