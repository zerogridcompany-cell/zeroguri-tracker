// _shared/approve-core.ts — 承認処理の中核（submission-approve〔主催者〕と submission-auto-approve〔自動〕で共用）。
// グループは group_id でまとめて処理。auto(Buffer)は各プラットフォームのチャンネルへ投稿、手動は承認のみ。
// 二重投稿防止: claim は status='pending' 条件付きUPDATE。Buffer応答不明は needs_review（自動再試行しない）。
import { bufferCreatePost } from "./buffer.ts";
import { decryptToken } from "./crypto.ts";
import { discordReply } from "./discord.ts";
import { archiveToDrive } from "./drive-archive.ts";

// deno-lint-ignore no-explicit-any
type DB = any;
type Sub = Record<string, unknown>;

export interface ApprovalResult {
  ok: boolean;
  approved: number;
  posted: number;
  ambiguous: number;
  errs: string[];
  conflict?: boolean;
  error?: string;
}

/** sub（代表）のグループ（または単体）を承認処理する。actorId=null は自動承認。 */
export async function processGroupApproval(
  db: DB,
  sub: Sub,
  caption: string,
  actorId: string | null,
): Promise<ApprovalResult> {
  const nowIso = new Date().toISOString();
  const groupId = (sub.group_id as string | null) ?? null;
  const subUserId = sub.user_id as string;
  const autoTag = actorId === null ? "自動承認: " : "";
  const logAudit = (subId: string, act: string, reason: string | null) =>
    db.from("submission_audit_log").insert({ submission_id: subId, action: act, actor_id: actorId, reason });

  const targets: Sub[] = groupId
    ? ((await db.from("video_submissions").select("*").eq("group_id", groupId).eq("user_id", subUserId).eq("status", "pending")).data ?? [])
    : [sub];
  const repMsgId = (targets.find((t) => t.discord_message_id)?.discord_message_id as string | null)
    ?? (sub.discord_message_id as string | null) ?? null;

  async function approveOne(t: Sub): Promise<{ done: boolean; posted: boolean; err?: string; ambiguous?: boolean }> {
    const tId = t.id as string;
    if ((t.submission_type as string) === "manual") {
      const { data: c } = await db.from("video_submissions")
        .update({ status: "approved", reviewed_by: actorId, reviewed_at: nowIso, caption, buffer_result: "manual_approved" })
        .eq("id", tId).eq("status", "pending").select("id");
      if (!c || c.length === 0) return { done: false, posted: false };
      await logAudit(tId, "approved", `${autoTag}手動: 投稿前承認（投稿後にURL登録で計測開始）`);
      return { done: true, posted: false };
    }

    const platform = (t.platform as string) || "instagram";
    const rawTime = (t.scheduled_at as string | null) || null;
    const past = rawTime !== null && (Number.isNaN(Date.parse(rawTime)) || Date.parse(rawTime) < Date.now() - 60_000);
    const time = rawTime && !past ? rawTime : null;
    let igType: "post" | "reel" | "story" =
      ["post", "reel", "story"].includes(t.ig_type as string) ? (t.ig_type as "post" | "reel" | "story") : "reel";
    if ((t.media_type as string) === "image" && igType === "reel") igType = "post";

    let channelId: string | null = null;
    if (t.linked_account_id) {
      const { data: la } = await db.from("linked_accounts").select("buffer_channel_id").eq("id", t.linked_account_id as string).maybeSingle();
      channelId = (la?.buffer_channel_id as string | null) ?? null;
    }
    let userToken: string | undefined;
    const { data: ub } = await db.from("user_buffer_connections").select("token_enc").eq("user_id", t.user_id as string).maybeSingle();
    if (ub?.token_enc) userToken = (await decryptToken(ub.token_enc as string)) ?? undefined;

    const willPost = Boolean(channelId);
    const initBuffer = willPost ? "scheduling" : "unscheduled";
    const { data: claimed } = await db.from("video_submissions")
      .update({ status: "approved", reviewed_by: actorId, reviewed_at: nowIso, caption, buffer_result: initBuffer, scheduled_at: time })
      .eq("id", tId).eq("status", "pending").select("id");
    if (!claimed || claimed.length === 0) return { done: false, posted: false };

    const hadDrive = (t.drive_folder as string | null) || null;
    const archiveOnce = async (): Promise<string | null> => hadDrive ?? (await archiveToDrive(db, t, tId));

    if (!willPost) {
      const drive = await archiveOnce();
      if (drive && !hadDrive) await db.from("video_submissions").update({ drive_folder: drive }).eq("id", tId);
      await logAudit(tId, "approved", `${autoTag}${platform}: 承認のみ（Buffer未接続）`);
      return { done: true, posted: false };
    }

    const ht = ((t.hashtags as string | null) ?? "").trim();
    const fullText = ht ? `${caption}\n\n${ht}` : caption;
    const posted = await bufferCreatePost({
      text: fullText,
      mediaUrl: t.public_url as string,
      mediaType: (t.media_type as string) === "image" ? "image" : "video",
      igType,
      platform,
      schedulingType: "notification",
      dueAt: time ?? undefined,
      channelId: channelId ?? undefined,
      token: userToken,
    });
    if (!posted.ok) {
      if (posted.ambiguous) {
        await db.from("video_submissions").update({ buffer_result: "needs_review" }).eq("id", tId);
        await logAudit(tId, "approved", `${autoTag}${platform}: Buffer応答不明（要確認・自動再試行なし）`);
        return { done: true, posted: false, ambiguous: true, err: posted.error };
      }
      // 確定的失敗。自動承認は「承認済み（投稿失敗）」で確定し無限リトライを止める。
      // 手動（主催者）承認は pending に戻して再承認できるようにする。
      if (actorId === null) {
        await db.from("video_submissions").update({
          status: "approved", reviewed_by: null, reviewed_at: nowIso, buffer_result: "post_failed",
        }).eq("id", tId);
        await logAudit(tId, "approved", `${autoTag}${platform}: Buffer投稿に失敗（${(posted.error ?? "").slice(0, 120)}）`);
        return { done: true, posted: false, err: posted.error };
      }
      await db.from("video_submissions").update({
        status: "pending", reviewed_by: null, reviewed_at: null, buffer_result: null,
      }).eq("id", tId);
      return { done: false, posted: false, err: posted.error };
    }
    const drive = await archiveOnce();
    await db.from("video_submissions").update({
      buffer_result: posted.type ?? "scheduled", drive_folder: drive, buffer_post_id: posted.postId ?? null,
    }).eq("id", tId);
    await logAudit(tId, "approved", `${autoTag}${platform}: Buffer に投稿（${time ?? "キュー"}）`);
    return { done: true, posted: true };
  }

  let approved = 0, postedN = 0, ambiguous = 0;
  const errs: string[] = [];
  for (const t of targets) {
    const r = await approveOne(t);
    if (r.done) approved++;
    if (r.posted) postedN++;
    if (r.ambiguous) ambiguous++;
    if (r.err && !r.ambiguous) errs.push(`${(t.platform as string) ?? ""}: ${r.err}`);
  }
  if (approved === 0) {
    if (errs.length) return { ok: false, approved, posted: postedN, ambiguous, errs, error: errs.join(" / ") };
    return { ok: false, approved, posted: postedN, ambiguous, errs, conflict: true, error: "この提出は既に処理済みです" };
  }
  // errs は「Buffer投稿に失敗した件数」。自動承認では失敗は確定（pendingに戻さない）ので
  // 「再承認」ではなく「投稿失敗＝Buffer再連携が必要」と正しく伝える。
  await discordReply(
    repMsgId,
    errs.length
      ? `⚠️ 承認しました（${errs.length}件はBuffer投稿に失敗・YouTube等のBuffer再連携が必要です）`
      : "✅ 承認完了",
  );
  return { ok: true, approved, posted: postedN, ambiguous, errs };
}
