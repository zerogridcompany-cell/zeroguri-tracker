// submission-schedule — クリエイター本人が自分の「承認済み」提出を予約投稿（verify_jwt=true）
// 承認だけ先に受けておき、後から（まとめて）予約したい人向け。
// IG は Buffer に予約 + Drive アーカイブ。YT/TikTok は手動投稿の予定日時を記録（Buffer未接続）。
// 本人(user_id)・承認済み(status=approved)のみ。IG は未予約('unscheduled')からのみ（二重投稿防止）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { bufferCreatePost } from "../_shared/buffer.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { archiveToDrive } from "../_shared/drive-archive.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    const b = await req.json().catch(() => ({}));
    const id = (b.id as string)?.trim();
    const rawAt = (b.scheduledAt as string | undefined)?.trim();
    if (!id || !rawAt) return error("id and scheduledAt required", 400);
    const t = Date.parse(rawAt);
    if (Number.isNaN(t)) return error("日時の形式が不正です", 400);
    if (t < Date.now() - 60_000) return error("未来の日時を指定してください", 400);
    if (t > Date.now() + 180 * 24 * 3600_000) return error("予約は180日以内で指定してください", 400);
    const scheduledAt = new Date(t).toISOString(); // UTC ISO に正規化（DB保存・Buffer送信を一致）

    const { data: sub } = await db.from("video_submissions").select("*").eq("id", id).maybeSingle();
    if (!sub) return error("submission not found", 404);
    if (sub.user_id !== user.id) return error("forbidden", 403);
    if (sub.status !== "approved") return error("承認後に予約できます", 409);

    const platform = (sub.platform as string) || "instagram";
    const hadDrive = (sub.drive_folder as string | null) || null;
    const logAudit = (reason: string) =>
      db.from("submission_audit_log").insert({ submission_id: id, action: "scheduled", actor_id: user.id, reason });

    // 非IG（YT/TikTok）: 手動投稿の予定日時を記録/再設定（外部呼び出しなし）。本人・承認済みのみ。
    if (platform !== "instagram") {
      const { data: upd } = await db.from("video_submissions").update({
        scheduled_at: scheduledAt, buffer_result: "no_channel",
      }).eq("id", id).eq("user_id", user.id).eq("status", "approved").select("id");
      if (!upd || upd.length === 0) return error("予約できない状態です", 409);
      if (!hadDrive) {
        const drive = await archiveToDrive(db, sub, id);
        if (drive) await db.from("video_submissions").update({ drive_folder: drive }).eq("id", id);
      }
      await logAudit(`${platform}: 手動投稿の予定（${scheduledAt}）`);
      return json({ ok: true, status: "scheduled" });
    }

    // IG: 投稿先 Buffer チャンネルを解決（提出の連携アカウント）。未接続なら予約不可。
    let channelId: string | null = null;
    if (sub.linked_account_id) {
      const { data: la } = await db.from("linked_accounts").select("buffer_channel_id").eq("id", sub.linked_account_id).maybeSingle();
      channelId = (la?.buffer_channel_id as string | null) ?? null;
    }
    if (!channelId) {
      return error("このアカウントはBufferに接続されていません。主催者がBufferで接続後に予約できます。", 409);
    }

    // 本人のBufferトークンを claim より前に解決（復号throwで 'scheduling' に固定されないように）。
    let userToken: string | undefined;
    const { data: ub } = await db.from("user_buffer_connections").select("token_enc").eq("user_id", user.id).maybeSingle();
    if (ub?.token_enc) userToken = (await decryptToken(ub.token_enc as string)) ?? undefined;

    // 未予約('unscheduled')からのみ予約可。原子的に 'scheduling' を取得（同時実行/二重投稿を防ぐ）。
    const { data: claimed } = await db.from("video_submissions").update({
      buffer_result: "scheduling", scheduled_at: scheduledAt,
    }).eq("id", id).eq("user_id", user.id).eq("status", "approved").eq("buffer_result", "unscheduled").select("id");
    if (!claimed || claimed.length === 0) {
      return error("すでに予約済み、または予約できない状態です", 409);
    }

    let igType = ["post", "reel", "story"].includes(sub.ig_type as string) ? (sub.ig_type as "post" | "reel" | "story") : "reel";
    if ((sub.media_type as string) === "image" && igType === "reel") igType = "post";

    const posted = await bufferCreatePost({
      text: (sub.caption as string | null) ?? "",
      mediaUrl: sub.public_url as string,
      mediaType: (sub.media_type as string) === "image" ? "image" : "video",
      igType,
      schedulingType: "notification",
      dueAt: scheduledAt,
      channelId,
      token: userToken,
    });
    if (!posted.ok) {
      if (posted.ambiguous) {
        // 応答不明 → 自動再試行させない（needs_review で止める。'unscheduled' に戻さない＝再claim不可）
        await db.from("video_submissions").update({ buffer_result: "needs_review" }).eq("id", id);
        await logAudit("Buffer応答不明（要確認・自動再試行なし）");
        return error("予約結果が確認できませんでした。重複投稿を避けるため再試行は行いません。サポートにご確認ください。", 409);
      }
      // 確定的失敗 → 未予約に戻す（再予約可能に）
      await db.from("video_submissions").update({ buffer_result: "unscheduled", scheduled_at: null }).eq("id", id);
      return error(posted.error ?? "Buffer 予約に失敗しました", 400);
    }
    const drive = hadDrive ?? (await archiveToDrive(db, sub, id));
    await db.from("video_submissions").update({
      buffer_result: posted.type ?? "scheduled", drive_folder: drive, buffer_post_id: posted.postId ?? null,
    }).eq("id", id);
    await logAudit(`Instagram に予約（${scheduledAt}）`);
    return json({ ok: true, status: "scheduled", driveArchived: Boolean(drive) });
  } catch (e) {
    return error(String(e), 500);
  }
});
