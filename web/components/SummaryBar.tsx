// web/components/SummaryBar.tsx — 稼いだ金額（確定請求額）のヒーロー表示
import { formatYen } from "@/lib/format";

export function SummaryBar({
  totals,
  onWithdraw,
}: {
  totals: { activeVideos: number; retiredVideos: number; billableAmount: number };
  sandbox?: boolean;
  onWithdraw?: () => void; // 稼いだ額の隣の「出金」ボタン
}) {
  return (
    <div>
      <div className="zg-eyebrow-ja">稼いだ金額</div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="zg-hero">{formatYen(totals.billableAmount)}</div>
        {onWithdraw && (
          <button type="button" onClick={onWithdraw} className="zg-capsule-accent shrink-0 text-[11px]">
            出金
          </button>
        )}
      </div>
    </div>
  );
}
