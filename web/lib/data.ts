// web/lib/data.ts — ダッシュボードデータ取得（sandbox モック / 実 Supabase 切替）
import { hasSupabase, supabase } from "@/lib/supabase";
import { mockDashboard } from "@/lib/mock";
import type {
  AccountStatus,
  CampaignSummary,
  DashboardData,
  VideoRow,
} from "@/lib/types";

/**
 * ダッシュボードデータを返す。
 * - Supabase 未設定（sandbox）の場合はデモデータ（mockDashboard）をそのまま返す。
 * - 設定済みの場合は集約ビューをベストエフォートで取得し、エラー / 欠損時は mock にフォールバック。
 */
export async function getDashboard(): Promise<DashboardData> {
  if (!hasSupabase || !supabase) return mockDashboard;

  try {
    const [accountsRes, campaignsRes, videosRes] = await Promise.all([
      supabase.from("v_account_dashboard").select("*"),
      supabase.from("v_campaign_summary").select("*"),
      supabase.from("v_billable").select("*"),
    ]);

    const error = accountsRes.error ?? campaignsRes.error ?? videosRes.error;
    if (error) throw error;

    const accounts = (accountsRes.data ?? []) as unknown as AccountStatus[];
    const campaignRows = (campaignsRes.data ?? []) as unknown as CampaignSummary[];
    const videoRows = (videosRes.data ?? []) as unknown as VideoRow[];

    if (accounts.length === 0 || campaignRows.length === 0) return mockDashboard;

    const campaigns: CampaignSummary[] = campaignRows.map((c) => ({
      ...c,
      videos: c.videos ?? videoRows,
    }));

    return {
      accounts,
      campaigns,
      totals: {
        activeVideos: accounts.reduce((n, a) => n + a.activeVideos, 0),
        retiredVideos: accounts.reduce((n, a) => n + a.retiredVideos, 0),
        billableAmount: accounts.reduce((n, a) => n + a.billableAmount, 0),
      },
      sandbox: false,
    };
  } catch {
    return mockDashboard;
  }
}
