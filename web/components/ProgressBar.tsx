// web/components/ProgressBar.tsx — 再生数 / 上限の進捗バー

import { formatNumber, progressPct } from "@/lib/format";

export function ProgressBar({ views, cap }: { views: number; cap: number }) {
  const pct = progressPct(views, cap);
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between font-display text-xs text-faint">
        <span className="tabular-nums">
          {formatNumber(views)} / {formatNumber(cap)}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-sumi"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
