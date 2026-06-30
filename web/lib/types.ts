// web/lib/types.ts — ダッシュボード共有型（DB ビューの形に対応）

export type Platform = "youtube" | "tiktok" | "instagram";
export type ConnectionStatus = "connected" | "disconnected" | "error";
export type DisplayStatus = "tracking" | "slowing" | "completed" | "retired" | "review";
export type OwnershipMethod = "challenge" | "oauth";

// v_account_dashboard + 連携ステータス
export interface AccountStatus {
  linkedAccountId: string | null;
  campaignId: string | null; // この連携が属する案件（案件ごとに分離）
  platform: Platform;
  handle: string | null;
  connectionStatus: ConnectionStatus;
  isNewAccount: boolean;
  activeVideos: number;
  retiredVideos: number;
  billableAmount: number;
}

// v_billable（動画行）
export interface VideoRow {
  trackedVideoId: string;
  platform: Platform;
  contentId: string;
  title: string | null;
  url?: string | null;
  handle?: string | null; // どの連携アカウントから投稿された動画か
  attributableViews: number;
  cap: number;
  billableViews: number;
  unitPrice: number;
  billableAmount: number;
  displayStatus: DisplayStatus;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  trend?: number[]; // 直近スナップショットの再生数推移（スパークライン用、任意）
}

// v_campaign_summary + 動画行
export interface CampaignSummary {
  campaignId: string;
  title: string;
  status: string;
  totalVideos: number;
  activeVideos: number;
  retiredVideos: number;
  totalBillableViews: number;
  totalBillableAmount: number;
  videos: VideoRow[];
  // 予算キャップ進捗（任意）
  cap?: { value: number; type: string } | null;
  earnedAmount?: number;
  countedAmount?: number;
  overAmount?: number;
  progressPct?: number | null;
}

// 案件の予算キャップ進捗（動画未追加でも案件選択でバーを出すため）
export interface CampaignProgress {
  cap: { value: number; type: string } | null;
  earnedAmount: number;
  countedAmount: number;
  overAmount: number;
  earnedViews: number;
  progressPct: number | null;
}

// ダッシュボード全体
export interface DashboardData {
  accounts: AccountStatus[];
  campaigns: CampaignSummary[];
  totals: {
    activeVideos: number; // 今コストがかかっている本数
    retiredVideos: number;
    billableAmount: number;
  };
  progressByCampaign?: Record<string, CampaignProgress>;
  posting?: PostingData;
  sandbox: boolean;
}

// 毎日投稿トラッキング
export interface PostingData {
  days: { date: string; posted: boolean }[];
  streak: number;
  postedToday: boolean;
  lastPostedDate: string | null;
  todayCount?: number; // 今日の投稿本数
  recentCount?: number; // 直近7日の投稿本数合計
}
