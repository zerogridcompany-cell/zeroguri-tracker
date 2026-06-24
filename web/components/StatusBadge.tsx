// web/components/StatusBadge.tsx — 表示ステータスのチップ

import type { DisplayStatus } from "@/lib/types";

const LABEL: Record<DisplayStatus, string> = {
  tracking: "計測中",
  slowing: "鈍化",
  completed: "完了",
  retired: "計測終了",
  review: "要確認",
};

// Tailwind の動的クラス名を確実に拾わせるための静的マップ
const CLASS: Record<DisplayStatus, string> = {
  tracking: "text-accent",
  slowing: "text-status-slowing",
  completed: "text-status-completed",
  retired: "text-faint",
  review: "text-status-review", // billing-integrity フラグ（drop/spike）
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={"chip " + CLASS[status]}>{LABEL[status]}</span>;
}
