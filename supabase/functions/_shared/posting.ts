// _shared/posting.ts — 毎日投稿トラッキングの集計（JST基準）
// 投稿日の集合から「連続投稿日数 / 今日投稿済み / 直近14日カレンダー」を導く。

const JST_OFFSET = 9 * 60 * 60 * 1000; // UTC+9

/** offset 日前の JST 日付文字列（YYYY-MM-DD）。日本はDST無しなので単純加減算でOK。 */
function jstDayStr(offsetDays: number): string {
  return new Date(Date.now() + JST_OFFSET - offsetDays * 86400000).toISOString().slice(0, 10);
}

export interface PostingSummary {
  days: { date: string; posted: boolean }[]; // 直近14日（古→新）
  streak: number; // 連続投稿日数（今日 or 昨日起点で連続して投稿してる日数）
  postedToday: boolean;
  lastPostedDate: string | null;
}

/** posted の JST 日付集合（Set<YYYY-MM-DD>）から投稿サマリを作る。 */
export function postingSummary(dates: Set<string>): PostingSummary {
  const today = jstDayStr(0);
  const postedToday = dates.has(today);

  // 連続日数: 今日投稿済みなら今日から、未投稿なら昨日から遡って連続を数える。
  let streak = 0;
  for (let i = postedToday ? 0 : 1; ; i++) {
    if (dates.has(jstDayStr(i))) streak++;
    else break;
  }

  const days: { date: string; posted: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = jstDayStr(i);
    days.push({ date: d, posted: dates.has(d) });
  }

  let lastPostedDate: string | null = null;
  for (let i = 0; i < 400; i++) {
    const d = jstDayStr(i);
    if (dates.has(d)) { lastPostedDate = d; break; }
  }

  return { days, streak, postedToday, lastPostedDate };
}
