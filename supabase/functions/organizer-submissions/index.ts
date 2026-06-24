// organizer-submissions — 提出動画の一覧（verify_jwt=true / オーガナイザー専用）
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser, likeExact } from "../_shared/supabase.ts";

const mkName = (p: Record<string, unknown> | undefined): string =>
  [p?.last_name_kanji, p?.first_name_kanji].filter(Boolean).join(" ") ||
  (p?.name_kanji as string | null) || (p?.internal_id as string | null) || "—";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    // 認可は検証済み JWT の email（不変）で判定。完全一致（ワイルドカード無効化）。
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", likeExact(user.email ?? "___none___")).maybeSingle();
    if (!org) return error("forbidden", 403);

    const [subRes, pendRes, unschedRes, profRes, logRes, setRes] = await Promise.all([
      db.from("video_submissions").select("*").order("created_at", { ascending: false }).limit(300),
      // 直近300件から漏れても、要対応（承認待ち / 承認済み未予約）は必ず含める（取りこぼし防止）
      db.from("video_submissions").select("*").eq("status", "pending"),
      db.from("video_submissions").select("*").eq("status", "approved").eq("buffer_result", "unscheduled"),
      db.from("profiles").select("user_id, internal_id, name_kanji, last_name_kanji, first_name_kanji"),
      db.from("submission_audit_log").select("*").order("created_at", { ascending: false }).limit(1000),
      db.from("org_settings").select("auto_approve").eq("id", 1).maybeSingle(),
    ]);
    const autoApprove = Boolean(setRes.data?.auto_approve);
    // id で重複排除して結合
    const rowMap = new Map<string, Record<string, unknown>>();
    for (const r of [...(subRes.data ?? []), ...(pendRes.data ?? []), ...(unschedRes.data ?? [])]) {
      rowMap.set(r.id as string, r);
    }
    const allRows = [...rowMap.values()].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)));
    const pmap = new Map<string, Record<string, unknown>>();
    for (const p of profRes.data ?? []) pmap.set(p.user_id as string, p);
    const logMap = new Map<string, { action: string; reason: string | null; at: string }[]>();
    for (const l of logRes.data ?? []) {
      const arr = logMap.get(l.submission_id as string) ?? [];
      arr.push({ action: l.action as string, reason: (l.reason as string | null) ?? null, at: l.created_at as string });
      logMap.set(l.submission_id as string, arr);
    }

    const submissions = allRows.map((s) => ({
      id: s.id,
      userId: s.user_id,
      userName: mkName(pmap.get(s.user_id as string)),
      internalId: (pmap.get(s.user_id as string)?.internal_id as string | null) ?? null,
      publicUrl: s.public_url,
      filename: s.filename,
      mediaType: s.media_type,
      submissionType: (s.submission_type as string | null) ?? "auto",
      trackedVideoId: (s.tracked_video_id as string | null) ?? null,
      groupId: (s.group_id as string | null) ?? null,
      platform: s.platform,
      handle: s.handle,
      igType: s.ig_type,
      caption: s.caption,
      hashtags: (s.hashtags as string | null) ?? null,
      scheduledAt: s.scheduled_at,
      status: s.status,
      bufferResult: s.buffer_result,
      rejectReason: s.reject_reason,
      driveFolder: s.drive_folder,
      reviewedAt: s.reviewed_at,
      createdAt: s.created_at,
      log: logMap.get(s.id as string) ?? [],
    }));
    // pending を先頭に
    submissions.sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1));

    return json({ submissions, autoApprove });
  } catch (e) {
    return error(String(e), 500);
  }
});
