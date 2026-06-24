// web/lib/mock.ts — サンドボックス用デモデータ（supabase/seed.sql を厳密にミラー）
// 実 API クレデンシャル / 起動中の DB 無しでダッシュボードを描画するためのモック。
import type {
  AccountStatus,
  CampaignSummary,
  DashboardData,
  DisplayStatus,
  Platform,
  VideoRow,
} from "@/lib/types";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 現在時刻から ms 後（負なら過去）の ISO 文字列。モジュール読込時に確定。 */
function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

// tracking / slowing = 課金中（active）、completed / retired = 引退（retired）
const ACTIVE_STATUSES: ReadonlyArray<DisplayStatus> = ["tracking", "slowing"];
const isActive = (s: DisplayStatus): boolean => ACTIVE_STATUSES.includes(s);

/** 1000再生ブロック単位: billableViews = floor(min(views,cap)/1000)*1000, amount = billableViews*unitPrice
 *  （1000再生に達していない動画は ¥0、1000再生ごとに ¥100） */
function makeVideo(v: Omit<VideoRow, "billableViews" | "billableAmount">): VideoRow {
  const capped = Math.min(v.attributableViews, v.cap);
  const billableViews = Math.floor(capped / 1000) * 1000;
  const billableAmount = Math.round(billableViews * v.unitPrice);
  return { ...v, billableViews, billableAmount };
}

// ───────── 案件「夏のドリンクPR 2026」の動画 4 本 ─────────
const videos: VideoRow[] = [
  // (a) 伸び盛り（毎日チェック）
  makeVideo({
    trackedVideoId: "d1111111-1111-1111-1111-111111111111",
    platform: "youtube",
    contentId: "dQw4w9WgXcQ",
    title: "新作ドリンク飲んでみた",
    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    attributableViews: 320000,
    cap: 500000,
    unitPrice: 0.1,
    displayStatus: "tracking",
    nextCheckAt: isoFromNow(12 * HOUR),
    lastCheckedAt: isoFromNow(-12 * HOUR),
    trend: [18000, 65000, 140000, 235000, 290000, 320000],
  }),
  // (b) cap 到達で完了
  makeVideo({
    trackedVideoId: "d2222222-2222-2222-2222-222222222222",
    platform: "youtube",
    contentId: "9bZkp7q19f0",
    title: "ドリンク開封ショート",
    url: "https://youtube.com/shorts/9bZkp7q19f0",
    attributableViews: 500000,
    cap: 500000,
    unitPrice: 0.1,
    displayStatus: "completed",
    nextCheckAt: isoFromNow(7 * DAY),
    lastCheckedAt: isoFromNow(-2 * DAY),
  }),
  // (c) 鈍化（既存アカ・3日間隔）
  makeVideo({
    trackedVideoId: "d3333333-3333-3333-3333-333333333333",
    platform: "tiktok",
    contentId: "7300000000000000001",
    title: "夏ドリンクTikTok",
    url: "https://tiktok.com/@demo_tt/video/7300000000000000001",
    attributableViews: 142000,
    cap: 300000,
    unitPrice: 0.1,
    displayStatus: "slowing",
    nextCheckAt: isoFromNow(2 * DAY),
    lastCheckedAt: isoFromNow(-1 * DAY),
  }),
  // (d) 完全停止で引退
  makeVideo({
    trackedVideoId: "d4444444-4444-4444-4444-444444444444",
    platform: "instagram",
    contentId: "C9aBcDeFgHi",
    title: "夏ドリンクReels",
    url: "https://instagram.com/reel/C9aBcDeFgHi",
    attributableViews: 12000,
    cap: 500000,
    unitPrice: 0.1,
    displayStatus: "retired",
    nextCheckAt: isoFromNow(7 * DAY),
    lastCheckedAt: isoFromNow(-3 * DAY),
  }),
];

// ───────── 連携アカウント（billableAmount = 配下動画の合計）─────────
function accountAgg(platform: Platform) {
  const vids = videos.filter((v) => v.platform === platform);
  return {
    activeVideos: vids.filter((v) => isActive(v.displayStatus)).length,
    retiredVideos: vids.filter((v) => !isActive(v.displayStatus)).length,
    billableAmount: sum(vids.map((v) => v.billableAmount)),
  };
}

const accounts: AccountStatus[] = [
  {
    linkedAccountId: "a1111111-1111-1111-1111-111111111111",
    campaignId: "c1111111-1111-1111-1111-111111111111",
    platform: "youtube",
    handle: "@demo_yt",
    connectionStatus: "connected",
    isNewAccount: true,
    ...accountAgg("youtube"),
  },
  {
    linkedAccountId: "a2222222-2222-2222-2222-222222222222",
    campaignId: "c1111111-1111-1111-1111-111111111111",
    platform: "tiktok",
    handle: "@demo_tt",
    connectionStatus: "connected",
    isNewAccount: false,
    ...accountAgg("tiktok"),
  },
  {
    linkedAccountId: "a3333333-3333-3333-3333-333333333333",
    campaignId: "c1111111-1111-1111-1111-111111111111",
    platform: "instagram",
    handle: "@demo_ig",
    connectionStatus: "connected",
    isNewAccount: true,
    ...accountAgg("instagram"),
  },
];

// ───────── 案件サマリ ─────────
const campaign: CampaignSummary = {
  campaignId: "c1111111-1111-1111-1111-111111111111",
  title: "夏のドリンクPR 2026",
  status: "active",
  totalVideos: videos.length,
  activeVideos: videos.filter((v) => isActive(v.displayStatus)).length,
  retiredVideos: videos.filter((v) => !isActive(v.displayStatus)).length,
  totalBillableViews: sum(videos.map((v) => v.billableViews)),
  totalBillableAmount: sum(videos.map((v) => v.billableAmount)),
  videos,
};

// ───────── ダッシュボード全体 ─────────
export const mockDashboard: DashboardData = {
  accounts,
  campaigns: [campaign],
  totals: {
    activeVideos: videos.filter((v) => isActive(v.displayStatus)).length,
    retiredVideos: videos.filter((v) => !isActive(v.displayStatus)).length,
    billableAmount: sum(videos.map((v) => v.billableAmount)),
  },
  sandbox: true,
};
