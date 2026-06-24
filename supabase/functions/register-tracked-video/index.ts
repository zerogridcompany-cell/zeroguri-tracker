// register-tracked-video/index.ts — 動画を tracked_videos に直接登録（verify_jwt=true / 承認なし）
// 「動画追加」の本体。content_id/url を正規化し、投稿者本人かを検証して baseline=0 で登録する。
// 本人確認・URL正規化は _shared/video-verify.ts に集約。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { detectPlatform, expandTikTokShort, normalizeVideo, verifyOwnershipAndDate } from "../_shared/video-verify.ts";

interface RegisterBody {
  campaign_id?: string;
  linked_account_id?: string;
  content_id?: string; // 動画ID または URL（どちらでも可）
  title?: string;
  url?: string;
  cap?: number;
  unit_price?: number;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("Unauthorized", 401);

    const body = (await req.json().catch(() => ({}))) as RegisterBody;
    if (!body.campaign_id || !body.linked_account_id) {
      return error("campaign_id and linked_account_id required", 400);
    }
    if (!body.content_id) return error("動画ID または URL を入力してください", 400);

    const { data: campaign } = await admin()
      .from("campaigns").select("id, owner_id, status, cap_default, unit_price, collection_start_date")
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

    let cidInput = body.content_id;
    let urlInput = body.url;
    if (account.platform === "tiktok") {
      const expanded = (await expandTikTokShort(urlInput)) ?? (await expandTikTokShort(cidInput));
      if (expanded) {
        urlInput = expanded;
        if (!/\/video\/\d+/.test(cidInput ?? "")) cidInput = expanded;
      }
    }

    const { contentId, url } = normalizeVideo(account.platform as string, cidInput, urlInput);
    if (!contentId) return error("動画ID/URL を解釈できませんでした", 400);

    const { data: dup } = await admin()
      .from("tracked_videos").select("id").eq("platform", account.platform).eq("content_id", contentId).maybeSingle();
    if (dup) {
      return error("この動画は既に登録されています。同じ動画は1回だけ計測できます（削除後の再追加は可能）", 409);
    }

    const v = await verifyOwnershipAndDate(account.platform as string, account.handle as string | null, contentId, url);
    if (!v.ok) return error(v.message, v.status);
    const publishedMs = v.publishedMs;

    if (campaign.collection_start_date && publishedMs) {
      const startMs = Date.parse(`${campaign.collection_start_date}T00:00:00Z`);
      if (!Number.isNaN(startMs) && publishedMs < startMs) {
        const pub = new Date(publishedMs).toISOString().slice(0, 10);
        return error(
          `この動画は案件の収集開始日（${campaign.collection_start_date}）より前に投稿されています（投稿日: ${pub}）。開始日以降の投稿のみ追加できます`,
          400,
        );
      }
    }

    const cap = body.cap ?? campaign.cap_default;
    const unitPrice = body.unit_price ?? campaign.unit_price;
    const nowIso = new Date().toISOString();

    const { data: inserted, error: upsertErr } = await admin()
      .from("tracked_videos")
      .upsert([{
        campaign_id: body.campaign_id,
        linked_account_id: body.linked_account_id,
        platform: account.platform,
        content_id: contentId,
        title: body.title ?? null,
        url,
        cap,
        unit_price: unitPrice,
        baseline_views: 0,
        last_views: 0,
        status: "active",
        next_check_at: nowIso,
        published_at: publishedMs ? new Date(publishedMs).toISOString() : nowIso,
      }], { onConflict: "platform,content_id", ignoreDuplicates: true })
      .select();
    if (upsertErr) return error(upsertErr.message, 500);

    const returned = inserted ?? [];
    if (returned.length > 0) {
      await admin().from("campaign_video_links").upsert(
        returned.map((r) => ({ campaign_id: body.campaign_id, tracked_video_id: r.id })),
        { onConflict: "campaign_id,tracked_video_id", ignoreDuplicates: true },
      );
    }

    return json({
      registered: returned.length,
      already_tracked: returned.length === 0,
      videos: returned,
      normalized: { content_id: contentId, url },
    });
  } catch (e) {
    return error(String(e), 500);
  }
});
