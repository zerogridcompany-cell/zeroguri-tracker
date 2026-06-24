// discord-notify — 提出されたら Discord に通知（pg_cron トリガから invoke）。verify_jwt=false（内部）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin } from "../_shared/supabase.ts";
import { discordPost, discordReply } from "../_shared/discord.ts";

function mkName(p: Record<string, unknown> | null | undefined, fallback: string): string {
  return ([p?.last_name_kanji, p?.first_name_kanji].filter(Boolean).join(" ") ||
    (p?.name_kanji as string | null) || fallback).trim();
}
const PLAT: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    const id = (body.submission_id as string)?.trim();
    const event = (body.event as string) || "submitted";
    if (!id) return error("submission_id required", 400);

    const db = admin();
    const { data: sub } = await db.from("video_submissions").select("*").eq("id", id).maybeSingle();
    if (!sub) return json({ ok: true, skipped: "no submission" });

    const { data: prof } = await db
      .from("profiles").select("internal_id, name_kanji, last_name_kanji, first_name_kanji")
      .eq("user_id", sub.user_id).maybeSingle();
    const name = mkName(prof, (prof?.internal_id as string | null) ?? "ユーザー");
    const platform = PLAT[sub.platform as string] ?? (sub.platform as string) ?? "";
    const handle = sub.handle ? ` @${String(sub.handle).replace(/^@/, "")}` : "";

    if (event === "approved") {
      await discordReply((sub.discord_message_id as string | null) ?? null, `✅ **承認完了** — ${name} さんのこの動画を承認しました。`);
      return json({ ok: true });
    }

    // submitted — クライアントから提出直後に直接呼ばれる（pg_netトリガ非依存）。
    // 重複通知は discord_message_id で防ぐ。グループは全メンバーに同じメッセージIDを記録（承認リプライ先に使う）。
    if (sub.discord_message_id) return json({ ok: true, skipped: "already notified" });
    let platformsLabel = `${platform}${handle}`;
    let memberIds: string[] = [id];
    if (sub.group_id) {
      const { data: members } = await db
        .from("video_submissions").select("id, platform, handle, discord_message_id")
        .eq("group_id", sub.group_id as string).eq("user_id", sub.user_id as string)
        .order("id", { ascending: true });
      const rows = members ?? [];
      if (rows.some((m) => m.discord_message_id)) return json({ ok: true, skipped: "group already notified" });
      if (rows.length) {
        memberIds = rows.map((r) => r.id as string);
        platformsLabel = rows
          .map((r) => `${PLAT[r.platform as string] ?? r.platform}${r.handle ? ` @${String(r.handle).replace(/^@/, "")}` : ""}`)
          .join("・");
      }
    }
    const cap = sub.caption ? `\n> ${String(sub.caption).slice(0, 140)}` : "";
    const content = `🎬 **${name}** さんが動画を提出しました（${platformsLabel}）。**承認待ち**です。${cap}\n${sub.public_url}`;
    const msgId = await discordPost(content);
    if (msgId) await db.from("video_submissions").update({ discord_message_id: msgId }).in("id", memberIds);
    return json({ ok: true, posted: Boolean(msgId) });
  } catch (e) {
    return error(String(e), 500);
  }
});
