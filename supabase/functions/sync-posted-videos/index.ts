// sync-posted-videos — Buffer で公開された予約投稿を、自動でトラッキング登録する（pg_cron が定期起動）。
// verify_jwt=false（内部）。service_role キー一致のみ実行可。
// 投稿は本人のアカウントへ Buffer 経由で出したものなので所有権は確定 → 投稿者検証は不要。
// 既存の tracked_videos には一切触れず、新規登録のみ（追加のみ）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin } from "../_shared/supabase.ts";

const BUFFER_API = "https://api.buffer.com/graphql";

function igContentId(link: string): string | null {
  const m = link.match(/\/(?:reels?|p|tv)\/([0-9A-Za-z_-]+)/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    // pg_cron から定期起動（tracking-tick 等と同様に verify_jwt=false で公開）。
    // 冪等かつ「実際にBufferで公開済みの提出」しか処理しないため、外部から叩かれても無害。
    const db = admin();
    const token = Deno.env.get("BUFFER_TOKEN");
    if (!token) return json({ ok: true, processed: 0, added: 0, note: "no buffer token" });

    // 公開URL待ちの提出（IG・承認済み・Buffer投稿IDあり・未トラッキング）。
    // 直近30日のみ対象（公開されないまま放置された投稿が枠を占有し続けないように）＋新しい順。
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data: subs } = await db.from("video_submissions")
      .select("id, linked_account_id, buffer_post_id")
      .not("buffer_post_id", "is", null)
      .eq("status", "approved")
      .eq("platform", "instagram")
      .is("tracked_video_id", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50);

    let added = 0;
    for (const s of subs ?? []) {
      try {
        const q = `{ post(input: { id: "${s.buffer_post_id}" }) { status sentAt metadata { __typename ... on InstagramPostMetadata { link } } } }`;
        const res = await fetch(BUFFER_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const j = await res.json().catch(() => ({}));
        const post = (j?.data as { post?: { status?: string; sentAt?: string; metadata?: { link?: string } } } | undefined)?.post;
        const link = post?.metadata?.link;
        if (!link) continue; // 公開前（link は公開後に入る）→ 次回再試行
        const contentId = igContentId(link);
        if (!contentId) continue;

        // 案件はアカウントから導出（linked_accounts.campaign_id）
        const { data: acc } = await db.from("linked_accounts").select("campaign_id").eq("id", s.linked_account_id).maybeSingle();
        const campaignId = (acc?.campaign_id as string | null) ?? null;
        if (!campaignId) continue; // 案件未紐付け → スキップ
        const { data: camp } = await db.from("campaigns").select("cap_default, unit_price").eq("id", campaignId).maybeSingle();
        if (!camp) continue;

        const nowIso = new Date().toISOString();
        const publishedIso = post?.sentAt ? new Date(post.sentAt).toISOString() : nowIso;
        // 重複防止: 同じ動画は全体で1回（手動追加済みなら既存を流用）
        const { data: ins } = await db.from("tracked_videos").upsert([{
          campaign_id: campaignId, linked_account_id: s.linked_account_id, platform: "instagram",
          content_id: contentId, url: link, cap: camp.cap_default, unit_price: camp.unit_price,
          baseline_views: 0, last_views: 0, status: "active", next_check_at: nowIso, published_at: publishedIso,
        }], { onConflict: "platform,content_id", ignoreDuplicates: true }).select("id");
        let tvId = (ins?.[0]?.id as string | undefined) ?? undefined;
        if (!tvId) {
          const { data: ex } = await db.from("tracked_videos").select("id").eq("platform", "instagram").eq("content_id", contentId).maybeSingle();
          tvId = (ex?.id as string | undefined) ?? undefined;
        }
        if (tvId) {
          await db.from("campaign_video_links").upsert(
            [{ campaign_id: campaignId, tracked_video_id: tvId }],
            { onConflict: "campaign_id,tracked_video_id", ignoreDuplicates: true },
          );
          await db.from("video_submissions").update({ tracked_video_id: tvId }).eq("id", s.id);
          added++;
        }
      } catch (_e) {
        /* この提出はスキップ。次回再試行。 */
      }
    }
    return json({ ok: true, processed: (subs ?? []).length, added });
  } catch (e) {
    return error(String(e), 500);
  }
});
