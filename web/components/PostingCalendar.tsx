// web/components/PostingCalendar.tsx — 毎日投稿トラッキングの表示
// 直近14日を「1日何本投稿したか」の本数ヒートマップで表示。
// 各マス: 上段=本数 / 下段=日付。色の濃さ=その日の本数。
// ＋ 直近14日合計・1日平均・連続投稿日数・今日の本数。

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

export function PostingCalendar({ posting, compact }: { posting?: Posting | null; compact?: boolean }) {
  if (!posting) return null;
  const { days, streak, postedToday, todayCount, total14, avgPerDay, maxCount } = posting;

  return (
    <div className={compact ? "" : "rounded-xl border border-line p-3"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="zg-eyebrow-ja">投稿状況（1日あたりの本数）</span>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-display tabular-nums text-sumi">連続 {streak}日</span>
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

      {/* 直近14日のサマリ */}
      <div className="mb-2 flex items-center gap-3 text-[11px] text-faint">
        <span className="tabular-nums">
          直近14日 合計 <span className="font-display text-sumi">{total14}</span> 本
        </span>
        <span className="tabular-nums">
          1日平均 <span className="font-display text-sumi">{avgPerDay}</span> 本
        </span>
      </div>

      {/* 本数ヒートマップ（上=本数 / 下=日付） */}
      <div className="flex flex-wrap gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}・${d.count}本`}
            className={
              "flex h-9 w-9 flex-col items-center justify-center rounded leading-none " +
              heatClass(d.count, maxCount)
            }
          >
            <span className="font-display text-[12px] tabular-nums">{d.count > 0 ? d.count : ""}</span>
            <span
              className={
                "mt-0.5 text-[8px] tabular-nums " + (d.count > 0 ? "opacity-80" : "text-faint")
              }
            >
              {dayNum(d.date)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
