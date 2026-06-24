// web/components/CampaignProgressBar.tsx — 案件の予算キャップ進捗
// 計上分（上限まで）は通常色、超過分はバーを越えて赤で表示。

import { formatYen, formatNumber } from "@/lib/format";

export interface CampaignCap {
  value: number;
  type: string; // 'amount' | 'views'
}

export function CampaignProgressBar({
  cap,
  earnedAmount,
  countedAmount,
  overAmount,
  earnedViews,
  progressPct,
}: {
  cap: CampaignCap | null;
  earnedAmount: number;
  countedAmount: number;
  overAmount: number;
  earnedViews?: number;
  progressPct: number | null;
}) {
  if (!cap) return null; // 上限なしは表示しない
  const isViews = cap.type === "views";
  const earned = isViews ? (earnedViews ?? 0) : earnedAmount;
  const counted = isViews ? Math.min(earned, cap.value) : countedAmount;
  const over = isViews ? Math.max(0, earned - cap.value) : overAmount;
  const fmt = (n: number) => (isViews ? formatNumber(Math.round(n)) + " 再生" : formatYen(n));

  const pct = cap.value > 0 ? (earned / cap.value) * 100 : 0;
  const sumiW = Math.min(100, pct); // 計上（上限まで）
  const redW = Math.min(60, Math.max(0, pct - 100)); // 超過（バーを越えて赤、表示上限+60%）

  return (
    <div className="py-1">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="zg-eyebrow-ja">案件キャップ</span>
        <span className="font-display text-sm tabular-nums text-sumi">
          {fmt(counted)} / {fmt(cap.value)}
          <span className="ml-1.5 text-faint">({Math.min(100, Math.round(progressPct ?? pct))}%)</span>
        </span>
      </div>
      {/* バー: 計上=墨、超過=右にはみ出して赤 */}
      <div className="relative h-3 w-full rounded-full bg-line">
        <div className="absolute inset-y-0 left-0 rounded-full bg-sumi" style={{ width: `${sumiW}%` }} />
        {redW > 0 && (
          <div
            className="absolute inset-y-0 rounded-r-full bg-[#A8443A]"
            style={{ left: "100%", width: `${redW}%` }}
          />
        )}
      </div>
      {over > 0 && (
        <div className="mt-3 font-display text-xs text-[#A8443A]">
          超過 +{fmt(over)}（未計上）
        </div>
      )}
    </div>
  );
}
