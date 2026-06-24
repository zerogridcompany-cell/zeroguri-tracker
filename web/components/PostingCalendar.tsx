// web/components/PostingCalendar.tsx — 毎日投稿トラッキングの表示
// 直近14日のマス（投稿あり=塗り）＋ 連続投稿日数 ＋ 今日の投稿状況。

export interface Posting {
  days: { date: string; posted: boolean }[];
  streak: number;
  postedToday: boolean;
  lastPostedDate: string | null;
}

function dayNum(date: string): string {
  return String(Number(date.slice(8, 10))); // 日のみ
}

export function PostingCalendar({ posting, compact }: { posting?: Posting | null; compact?: boolean }) {
  if (!posting) return null;
  const { days, streak, postedToday } = posting;

  return (
    <div className={compact ? "" : "rounded-xl border border-line p-3"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="zg-eyebrow-ja">投稿状況</span>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-display tabular-nums text-sumi">連続 {streak}日</span>
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
      <div className="flex flex-wrap gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}${d.posted ? "・投稿あり" : "・投稿なし"}`}
            className={
              "flex h-6 w-6 items-center justify-center rounded text-[9px] tabular-nums " +
              (d.posted
                ? "bg-accent text-white"
                : "border border-line text-faint")
            }
          >
            {dayNum(d.date)}
          </div>
        ))}
      </div>
    </div>
  );
}
