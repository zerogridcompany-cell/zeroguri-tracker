// web/components/PostingCalendar.tsx — 毎日投稿トラッキングの表示
// 直近14日のマス（全SNS合算の投稿本数）＋ 今日の投稿状況。
// 目標(最低/最高)が設定されていれば、日別マスを達成状況で色分けする。

export interface Posting {
  days: { date: string; posted: boolean; count?: number }[];
  streak: number;
  postedToday: boolean;
  lastPostedDate: string | null;
  todayCount?: number; // 今日の投稿本数
  recentCount?: number; // 直近7日の投稿本数合計
}

function dayNum(date: string): string {
  return String(Number(date.slice(8, 10))); // 日のみ
}

// 日別マスの色（最低/最高が設定されている時のみ色分け）。
//  最高達成→濃ミント / 最低達成→ミント / 投稿ありだが最低未満→金 / 未投稿→ローズ / 目標なし→従来
function dayClass(posted: boolean, count: number, min: number | null, max: number | null): string {
  if (min != null || max != null) {
    const minT = min ?? max ?? 0; // 最低が無ければ最高を基準に
    if (max != null && count >= max) return "bg-ok2 text-sumi"; // 最高達成
    if (count >= minT) return "bg-ok text-sumi"; // 最低達成
    if (count > 0) return "bg-warn text-sumi"; // 投稿あり・最低未満
    return "bg-bad text-sumi"; // 未投稿
  }
  return posted ? "bg-accent text-white" : "border border-line text-faint";
}

export function PostingCalendar({
  posting,
  compact,
  goalMin = null,
  goalMax = null,
}: {
  posting?: Posting | null;
  compact?: boolean;
  goalMin?: number | null;
  goalMax?: number | null;
}) {
  if (!posting) return null;
  const { days, postedToday, streak } = posting;
  const hasGoal = goalMin != null || goalMax != null;

  // 連続日数: 目標がある時は「最低本数を連続で達成している日数」（今日はまだ途中なら猶予）。
  // 目標なしはサーバー集計の汎用ストリーク（何か投稿すれば加算）。※目標あり時は直近14日内で算出。
  const minT = goalMin ?? goalMax ?? null;
  let goalStreak = 0;
  if (minT != null) {
    for (let i = days.length - 1; i >= 0; i--) {
      const c = days[i].count ?? 0;
      if (c >= minT) {
        goalStreak++;
        continue;
      }
      if (i === days.length - 1) continue; // 今日はまだ途中 → 途切れさせない
      break;
    }
  }
  const streakDays = hasGoal ? goalStreak : streak;

  return (
    <div className={compact ? "" : "rounded-xl border border-line p-3"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="zg-eyebrow-ja">投稿状況</span>
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
          {hasGoal ? (
            <span className="rounded-full bg-line/50 px-2 py-0.5 text-faint">
              目標 最低 <span className="font-display tabular-nums text-sumi">{goalMin ?? "—"}</span>
              {" ・ "}最高 <span className="font-display tabular-nums text-sumi">{goalMax ?? "—"}</span> 本/日
            </span>
          ) : null}
          <span
            className="font-display tabular-nums text-sumi"
            title={hasGoal ? "最低本数を連続で達成している日数" : "連続で投稿している日数"}
          >
            {hasGoal ? "最低連続" : "連続"} {streakDays}日
          </span>
          <span
            className={
              "rounded-full px-2 py-0.5 " +
              (postedToday ? "bg-accent/15 text-accent" : "bg-line/50 text-faint")
            }
          >
            {postedToday ? "今日 投稿済み" : "今日 未投稿"}
          </span>
        </div>
      </div>
      {/* 日別の投稿本数（全SNS合算）: 直近14日。数字＝その日の投稿本数。 */}
      <div className="flex flex-wrap gap-1">
        {days.map((d) => {
          const n = d.count ?? 0;
          const goalNote = hasGoal ? `（目標 最低${goalMin ?? "—"}・最高${goalMax ?? "—"}本）` : "";
          return (
            <div
              key={d.date}
              title={`${d.date}・${d.posted ? `${n || 1}本` : "投稿なし"}${goalNote}`}
              className={
                "flex h-7 w-7 flex-col items-center justify-center rounded leading-none tabular-nums " +
                dayClass(d.posted, n, goalMin, goalMax)
              }
            >
              <span className="text-[7px] opacity-70">{dayNum(d.date)}</span>
              <span className="text-[11px] font-semibold">{d.posted ? n || 1 : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
