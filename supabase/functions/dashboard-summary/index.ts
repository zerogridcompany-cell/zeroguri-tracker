// dashboard-summary — クリエイター集計（verify_jwt=true）
// 「自分の連携アカウント由来の動画」を案件ごとに見せる（自分が作った案件＋参加した案件の両方）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { isSandbox } from "../_shared/env.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { postingSummary } from "../_shared/posting.ts";

type Platform = "youtube" | "tiktok" | "instagram";
type ConnectionStatus = "connected" | "disconnected" | "error";
type DisplayStatus = "tracking" | "slowing" | "completed" | "retired" | "review";

const PLATFORM_ORDER: Platform[] = ["youtube", "instagram", "tiktok"];
const num = (v: unknown): number => Number(v ?? 0);

function mapConnection(s: string | null | undefined): ConnectionStatus {
  if (s === "connected") return "connected";
  if (s === "error") return "error";
  return "disconnected";
}

/** platform + handle + content_id から動画URLを組む（飛べるように）。 */
function buildVideoUrl(platform: string, handle: string | null, contentId: string): string | null {
  const h = (handle ?? "").replace(/^@/, "");
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${contentId}`;
  if (platform === "tiktok") return h ? `https://www.tiktok.com/@${h}/video/${contentId}` : null;
  if (platform === "instagram") return `https://www.instagram.com/reel/${contentId}/`;
  return null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "GET" && req.method !== "POST") return error("method", 405);

  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    // 連携ステータス（per linked account）
    const { data: acctRows, error: acctErr } = await db
      .from("v_account_dashboard")
      .select("linked_account_id, campaign_id, platform, handle, connection_status, is_new_account, active_videos, retired_videos, billable_amount")
      .eq("user_id", user.id);
    if (acctErr) return error(acctErr.message, 500);

    const accountIds = (acctRows ?? [])
      .map((r) => r.linked_account_id as string | null)
      .filter((x): x is string => !!x);

    // linked_account_id → handle（どのアカウントから投稿された動画か表示するため）
    const handleByAccount = new Map<string, string | null>();
    for (const r of acctRows ?? []) handleByAccount.set(r.linked_account_id as string, (r.handle as string | null) ?? null);

    // 連携済みの全アカウントをそのまま返す（同一プラットフォームに2つ以上も可）。
    // 未連携プラットフォームの行は返さない（UI 側でプラットフォーム一覧から連携導線を出す）。
    const platformRank = (p: string) => {
      const i = PLATFORM_ORDER.indexOf(p as Platform);
      return i < 0 ? 99 : i;
    };
    const accounts = (acctRows ?? [])
      .map((r) => ({
        linkedAccountId: r.linked_account_id as string,
        campaignId: (r.campaign_id as string | null) ?? null,
        platform: r.platform as Platform,
        handle: r.handle as string | null,
        connectionStatus: mapConnection(r.connection_status as string),
        isNewAccount: !!r.is_new_account,
        activeVideos: num(r.active_videos),
        retiredVideos: num(r.retired_videos),
        billableAmount: num(r.billable_amount),
      }))
      .sort((a, b) => platformRank(a.platform) - platformRank(b.platform));

    // 自分の動画（連携アカウント由来）
    const videosByCampaign = new Map<string, Record<string, unknown>[]>();
    const campaignIds = new Set<string>();
    if (accountIds.length) {
      const { data: vb, error: vbErr } = await db
        .from("v_billable")
        .select("tracked_video_id, linked_account_id, campaign_id, platform, content_id, title, attributable_views, cap, billable_views, net_views, unit_price, billable_amount, status, next_check_at, last_checked_at, display_status")
        .in("linked_account_id", accountIds);
      if (vbErr) return error(vbErr.message, 500);
      for (const r of vb ?? []) {
        const cid = r.campaign_id as string;
        campaignIds.add(cid);
        const arr = videosByCampaign.get(cid) ?? [];
        arr.push(r);
        videosByCampaign.set(cid, arr);
      }
    }

    // 動画が属する案件のタイトル
    let campaignMeta: Record<string, { title: string; status: string }> = {};
    const progMap = new Map<string, Record<string, unknown>>();
    if (campaignIds.size) {
      const [{ data: cs }, { data: prog }] = await Promise.all([
        db.from("campaigns").select("id, title, status").in("id", [...campaignIds]),
        db.from("v_campaign_progress").select("*").in("campaign_id", [...campaignIds]),
      ]);
      for (const c of cs ?? []) campaignMeta[c.id as string] = { title: c.title as string, status: c.status as string };
      for (const p of prog ?? []) progMap.set(p.campaign_id as string, p);
    }

    // 確定台帳ベースの稼ぎ: 案件ごとの確定 gross（floor(credited)×unit_price）と、ユーザーの net（gross−既払い）
    const { data: ucb } = await db
      .from("v_user_campaign_billing").select("campaign_id, billable_amount").eq("user_id", user.id);
    const creditMap = new Map<string, number>();
    for (const r of ucb ?? []) creditMap.set(r.campaign_id as string, num(r.billable_amount));
    const { data: ut } = await db
      .from("v_user_totals").select("billable_amount").eq("user_id", user.id).maybeSingle();
    const userNet = num(ut?.billable_amount);

    // 毎日投稿トラッキング（自分の投稿日 → 連続日数・今日投稿本数・直近14日の本数）
    const { data: pd } = await db
      .from("v_user_posting_days").select("posted_date, posts").eq("user_id", user.id);
    const postingCounts = new Map<string, number>();
    for (const r of pd ?? []) {
      const d = r.posted_date as string;
      postingCounts.set(d, (postingCounts.get(d) ?? 0) + Number(r.posts ?? 0));
    }
    const posting = postingSummary(postingCounts);

    const campaigns = [...campaignIds].map((cid) => {
      const vids = (videosByCampaign.get(cid) ?? []).map((r) => {
        const handle = handleByAccount.get(r.linked_account_id as string) ?? null;
        return {
        trackedVideoId: r.tracked_video_id as string,
        platform: r.platform as Platform,
        contentId: r.content_id as string,
        title: r.title as string | null,
        handle,
        url: buildVideoUrl(r.platform as string, handle, r.content_id as string),
        attributableViews: num(r.attributable_views),
        cap: num(r.cap),
        billableViews: num(r.billable_views),
        netViews: num(r.net_views),
        unitPrice: num(r.unit_price),
        billableAmount: num(r.billable_amount),
        displayStatus: r.display_status as DisplayStatus,
        nextCheckAt: r.next_check_at as string | null,
        lastCheckedAt: r.last_checked_at as string | null,
        };
      });
      let active = 0, retired = 0, unitPrice = 0;
      for (const v of vids) {
        if (v.displayStatus === "retired" || v.displayStatus === "completed") retired++;
        else active++;
        if (v.unitPrice) unitPrice = v.unitPrice; // 案件内で一律
      }
      // 案件の稼いだ額は確定台帳ベース（floor(credited)×unit_price）。確定ロック＋キャップ反映。
      const bAmt = creditMap.get(cid) ?? 0;
      const bViews = unitPrice > 0 ? Math.round(bAmt / unitPrice) : 0;
      const prog = progMap.get(cid);
      return {
        campaignId: cid,
        title: campaignMeta[cid]?.title ?? "(案件)",
        status: campaignMeta[cid]?.status ?? "active",
        totalVideos: vids.length,
        activeVideos: active,
        retiredVideos: retired,
        totalBillableViews: bViews,
        totalBillableAmount: bAmt,
        // 予算キャップ進捗
        cap: prog?.cap_value != null
          ? { value: num(prog.cap_value), type: (prog.cap_type as string) ?? "amount" }
          : null,
        earnedAmount: num(prog?.earned_amount),
        countedAmount: num(prog?.counted_amount),
        overAmount: num(prog?.over_amount),
        progressPct: prog?.progress_pct != null ? num(prog.progress_pct) : null,
        videos: vids,
      };
    });

    // 「稼いだ金額」= 確定台帳 gross − 既払い（v_user_totals と一致＝ペイアウト画面と同期）。
    // 保留中は引き出し画面の残高側で差し引く。
    const totals = {
      activeVideos: accounts.reduce((s, a) => s + a.activeVideos, 0),
      retiredVideos: accounts.reduce((s, a) => s + a.retiredVideos, 0),
      billableAmount: userNet,
    };

    // 全案件の予算キャップ進捗（動画を追加していなくても、案件を選べばバーを定位置に出すため）
    const { data: allProg } = await db
      .from("v_campaign_progress").select("*").not("cap_value", "is", null);
    const progressByCampaign: Record<string, unknown> = {};
    for (const p of allProg ?? []) {
      progressByCampaign[p.campaign_id as string] = {
        cap: { value: num(p.cap_value), type: (p.cap_type as string) ?? "amount" },
        earnedAmount: num(p.earned_amount),
        countedAmount: num(p.counted_amount),
        overAmount: num(p.over_amount),
        earnedViews: num(p.earned_views),
        progressPct: p.progress_pct != null ? num(p.progress_pct) : null,
      };
    }

    return json({ accounts, campaigns, totals, progressByCampaign, posting, sandbox: isSandbox() });
  } catch (e) {
    return error(String(e), 500);
  }
});
