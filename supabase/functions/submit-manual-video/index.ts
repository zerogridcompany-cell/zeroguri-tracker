// submit-manual-video/index.ts — 手動（投稿済み）動画を「提出」する（verify_jwt=true）
// register-tracked-video と同じ本人確認をしたうえで、即トラッキングせず video_submissions に
// submission_type='manual' で提出 → 主催者の承認ページに並ぶ → 承認で tracked_videos に登録される。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { detectPlatform, expandTikTokShort, normalizeVideo, verifyOwnershipAndDate } from "../_shared/video-verify.ts";

interface Body {
  campaign_id?: string;
  linked_account_id?: string;
  content_id?: string; // 投稿済み動画のID または URL
  title?: string;
  url?: string;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("Unauthorized", 401);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.campaign_id || !body.linked_account_id) return error("campaign_id and linked_account_id required", 400);
    if (!body.content_id) return error("動画ID または URL を入力してください", 400);

    const { data: campaign } = await admin()
      .from("campaigns").select("id, owner_id, status, collection_start_date")
      .eq("id", body.campaign_id).maybeSingle();
    if (!campaign) return error("campaign not found", 404);
    if (campaign.owner_id !== user.id && campaign.status !== "active") return error("Forbidden", 403);

    const { data: account } = await admin()
      .from("linked_accounts").select("id, user_id, campaign_id, platform, handle, status")
      .eq("id", body.linked_account_id).maybeSingle();
    if (!account || account.user_id !== user.id) return error("Forbidden", 403);
    if (account.status !== "connected") {
      return error("このアカウントは本人確認が完了していません。先にアカウント連携（確認）を済ませてください", 403);
    }
    if (account.campaign_id && account.campaign_id !== body.campaign_id) {
      return error("この連携アカウントは別の案件のものです。この案件で改めてアカウントを連携してください", 409);
    }

    const detected = detectPlatform(body.url ?? body.content_id ?? "");
    if (detected && detected !== account.platform) {
      return error(`選択した ${account.platform} アカウントに ${detected} の動画は追加できません`, 400);
    }

    // TikTok 短縮リンク → canonical
    let cidInput = body.content_id;
    let urlInput = body.url;
    if (account.platform === "tiktok") {
      const expanded = (await expandTikTokShort(urlInput)) ?? (await expandTikTokShort(cidInput));
      if (expanded) {
        urlInput = expanded;
        if (!/\/video\/\d+/.test(cidInput ?? "")) cidInput = expanded;
      }
    }

    const { contentId, url } = normalizeVideo(account.platform, cidInput, urlInput);
    if (!contentId) return error("動画ID/URL を解釈できませんでした", 400);

    // 既にトラッキング済み？
    const { data: dup } = await admin()
      .from("tracked_videos").select("id").eq("platform", account.platform).eq("content_id", contentId).maybeSingle();
    if (dup) {
      return error("この動画は既に登録されています。同じ動画は1回だけ計測できます（削除後の再追加は可能）", 409);
    }
    // 既に提出済み（承認待ち）？
    const { data: dupSub } = await admin()
      .from("video_submissions").select("id")
      .eq("platform", account.platform).eq("content_id", contentId).eq("status", "pending").maybeSingle();
    if (dupSub) return error("この動画は既に提出済みです（承認待ち）", 409);

    // 投稿者本人かの検証＋投稿日時
    const v = await verifyOwnershipAndDate(account.platform, account.handle, contentId, url);
    if (!v.ok) return error(v.message, v.status);
    const publishedMs = v.publishedMs;

    // 収集開始日チェック
    if (campaign.collection_start_date && publishedMs) {
      const startMs = Date.parse(`${campaign.collection_start_date}T00:00:00Z`);
      if (!Number.isNaN(startMs) && publishedMs < startMs) {
        const pub = new Date(publishedMs).toISOString().slice(0, 10);
        return error(
          `この動画は案件の収集開始日（${campaign.collection_start_date}）より前に投稿されています（投稿日: ${pub}）。開始日以降の投稿のみ提出できます`,
          400,
        );
      }
    }

    // 提出（pending）。platform/handle はトリガが連携元から確定するが、値も渡しておく。
    const { data: inserted, error: insErr } = await admin().from("video_submissions").insert({
      user_id: user.id,
      submission_type: "manual",
      campaign_id: body.campaign_id,
      linked_account_id: body.linked_account_id,
      platform: account.platform,
      handle: account.handle,
      content_id: contentId,
      url,
      public_url: url, // 主催者プレビュー＆Discord通知用（投稿URL）
      title: body.title?.trim() || null,
      media_type: "video",
      published_at: publishedMs ? new Date(publishedMs).toISOString() : null,
    }).select("id").maybeSingle();
    if (insErr) return error(insErr.message, 500);

    return json({ ok: true, submission_id: inserted?.id ?? null, normalized: { content_id: contentId, url } });
  } catch (e) {
    return error(String(e), 500);
  }
});
