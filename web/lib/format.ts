// web/lib/format.ts — 表示フォーマット

export function formatNumber(n: number): string {
  return n.toLocaleString("ja-JP");
}

export function formatYen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

// ゼログリ手数料 = 報酬総額 × 8% ＋ ¥330（DB トリガ set_payout_fee と一致）
export const ZEROGURI_FEE_RATE = 0.08;
export const ZEROGURI_FEE_FLAT = 330;

/** 報酬総額からゼログリ手数料を算出（0以下なら0） */
export function zeroguriFee(amount: number): number {
  if (amount <= 0) return 0;
  return Math.round(amount * ZEROGURI_FEE_RATE) + ZEROGURI_FEE_FLAT;
}

// 引き出しの最低金額（報酬総額がこれ未満だとリクエスト不可）
export const MIN_PAYOUT = 2000;

/** 実際の受取/振込額 = 報酬総額 − ゼログリ手数料（手数料は企業側が差し引く。0未満は0） */
export function payoutNet(amount: number): number {
  return Math.max(0, amount - zeroguriFee(amount));
}

export function formatCompact(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万";
  return n.toLocaleString("ja-JP");
}

export function progressPct(views: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((views / cap) * 100));
}

/** 次回チェック予定の相対表示（「12時間後」「2日後」「まもなく」） */
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "まもなく";
  const h = Math.round(diffMs / 3600000);
  if (h < 24) return `${h}時間後`;
  return `${Math.round(h / 24)}日後`;
}

/** next_check_at までのライブ残り時間（now=現在ms）。"あと43分"／"あと1時間20分"／"あと45秒"／"まもなく"。 */
export function formatCountdown(iso: string | null, now: number): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "まもなく";
  const totalSec = Math.floor(diff / 1000);
  if (totalSec < 60) return `あと${totalSec}秒`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `あと${totalMin}分`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `あと${h}時間${m > 0 ? `${m}分` : ""}`;
}

/** 最終計測からの経過（now=現在ms）。"たった今"／"3分前"／"2時間前"。 */
export function formatAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const diff = now - new Date(iso).getTime();
  if (diff < 45000) return "たった今計測";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}分前に計測`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前に計測`;
  return `${Math.floor(h / 24)}日前に計測`;
}
