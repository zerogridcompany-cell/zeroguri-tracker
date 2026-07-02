// web/components/PostingCalendar.tsx — 毎日投稿トラッキングの表示
// 目標(最低/最高)が渡されたら: 達成状況で色分け＋最低連続日数（ランキング用）。
// 目標なし: 「1日何本」の本数ヒートマップ＋直近14日合計/平均（組織ダッシュボード用）。

export interface PostingDay {
  date: string;
  posted: boolean;
  count: number;
}

export interface Posting {
  days: PostingDay[];
  streak: number;
  postedToday: boolean;
  todayCount: number;
  total14: number;
  avgPerDay: number;
  maxCount: number;
  lastPostedDate: string | null;
}

function dayNum(date: string): string {
  return String(Number(date.slice(8, 10))); // 日のみ
}

/** 本数 → 背景の不透明度クラス（0=空, 多い=濃い）。maxCount を上限に4段階。 */
function heatClass(count: number, maxCount: number): string {
  if (count <= 0) return "border border-line text-faint";
  const max = Math.max(maxCount, 1);
  const ratio = count / max;
  if (ratio <= 0.25) return "bg-accent/30 text-sumi";
  if (ratio <= 0.5) return "bg-accent/55 text-white";
  if (ratio <= 0.75) return "bg-accent/75 text-white";
  return "bg-accent text-white";
}

// 目標の色（最低/最高）: 最高達成→濃ミント / 最低達成→ミント / 投稿ありだが最低未満→金 / 未投稿→ローズ
function goalClass(count: number, min: number | null, max: number | null): string {
  const minT = min ?? max ?? 0; // 最低が無ければ最高を基準に
  if (max != null && count >= max) return "bg-ok2 text-sumi";
  if (count >= minT) return "bg-ok text-sumi";
  if (count > 0) return "bg-warn text-sumi";
  return "bg-bad text-sumi";
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
  const { days, streak, postedToday, todayCount, total14, avgPerDay, maxCount } = posting;
  const hasGoal = goalMin != null || goalMax != null;

  // 目標がある時の連続日数＝「最低本数を連続で達成している日数」（今日はまだ途中なら猶予）。
  const minT = goalMin ?? goalMax ?? null;
  let goalStreak = 0;
  if (minT != null) {
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count >= minT) {
        goalStreak++;
        continue;
      }
      if (i === days.length - 1) continue; // 今日はまだ途中 → 途切れさせない
      break;
    }
  }

  return (
    <div className={compact ? "" : "rounded-xl border border-line p-3"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="zg-eyebrow-ja">投稿状況{hasGoal ? "" : "（1日あたりの本数）"}</span>
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
            {hasGoal ? "最低連続" : "連続"} {hasGoal ? goalStreak : streak}日
          </span>
          <span
            className={
              "rounded-full px-2 py-0.5 tabular-nums " +
              (postedToday ? "bg-accent/15 text-accent" : "bg-line/50 text-faint")
            }
          >
            {postedToday ? `今日 ${todayCount}本` : "今日 未投稿"}
          </span>
        </div>
      </div>

      {/* 直近14日のサマリ（目標なしの時のみ） */}
      {hasGoal ? null : (
        <div className="mb-2 flex items-center gap-3 text-[11px] text-faint">
          <span className="tabular-nums">
            直近14日 合計 <span className="font-display text-sumi">{total14}</span> 本
          </span>
          <span className="tabular-nums">
            1日平均 <span className="font-display text-sumi">{avgPerDay}</span> 本
          </span>
        </div>
      )}

      {/* 日別マス（上=本数 / 下=日付）。目標があれば達成色、無ければ本数ヒートマップ。 */}
      <div className="flex flex-wrap gap-1">
        {days.map((d) => {
          const goalNote = hasGoal ? `（目標 最低${goalMin ?? "—"}・最高${goalMax ?? "—"}本）` : "";
          return (
            <div
              key={d.date}
              title={`${d.date}・${d.count}本${goalNote}`}
              className={
                "flex h-9 w-9 flex-col items-center justify-center rounded leading-none " +
                (hasGoal ? goalClass(d.count, goalMin, goalMax) : heatClass(d.count, maxCount))
              }
            >
              <span className="font-display text-[12px] tabular-nums">{d.count > 0 ? d.count : ""}</span>
              <span
                className={"mt-0.5 text-[8px] tabular-nums " + (d.count > 0 ? "opacity-80" : "text-faint")}
              >
                {dayNum(d.date)}
              </span>
            </div>
          );
        })}
      </div>

      {/* 日別マスの色の凡例（最低/最高ベース） */}
      {hasGoal ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-ok2" />
            最高達成
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-ok" />
            最低達成
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-warn" />
            投稿あり・最低未満
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-bad" />
            未投稿
          </span>
        </div>
      ) : null}
    </div>
  );
}
