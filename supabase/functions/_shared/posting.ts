// _shared/posting.ts — 毎日投稿トラッキングの集計（JST基準）
// 投稿日の集合から「連続投稿日数 / 今日投稿済み / 直近14日カレンダー」を導く。

const JST_OFFSET = 9 * 60 * 60 * 1000; // UTC+9

/** offset 日前の JST 日付文字列（YYYY-MM-DD）。日本はDST無しなので単純加減算でOK。 */
function jstDayStr(offsetDays: number): string {
  return new Date(Date.now() + JST_OFFSET - offsetDays * 86400000).toISOString().slice(0, 10);
}

export interface PostingDay {
  date: string;
  posted: boolean;
  count: number; // その日の投稿本数（JST）
}

export interface PostingSummary {
  days: PostingDay[]; // 直近14日（古→新）。count付き
  streak: number; // 連続投稿日数（今日 or 昨日起点で連続して投稿してる日数）
  postedToday: boolean;
  todayCount: number; // 今日の投稿本数
  total14: number; // 直近14日の合計投稿本数
  avgPerDay: number; // 直近14日の1日平均（小数1桁）
  maxCount: number; // 14日内の1日最大本数（ヒートマップの濃淡スケール用）
  lastPostedDate: string | null;
}

/**
 * 投稿サマリを作る。入力は
 *   - Set<YYYY-MM-DD>          … 旧来。各日 1 本として扱う
 *   - Map<YYYY-MM-DD, number>  … 日付→本数（「1日何本」表示用）
 * のどちらでも可。
 */
export function postingSummary(input: Set<string> | Map<string, number>): PostingSummary {
  // 日付→本数に正規化。
  const counts = new Map<string, number>();
  if (input instanceof Map) {
    for (const [d, c] of input) counts.set(d, Number(c) || 0);
  } else {
    for (const d of input) counts.set(d, 1);
  }
  const countOf = (d: string): number => counts.get(d) ?? 0;
  const has = (d: string): boolean => countOf(d) > 0;

  const today = jstDayStr(0);
  const postedToday = has(today);
  const todayCount = countOf(today);

  // 連続日数: 今日投稿済みなら今日から、未投稿なら昨日から遡って連続を数える。
  let streak = 0;
  for (let i = postedToday ? 0 : 1; ; i++) {
    if (has(jstDayStr(i))) streak++;
    else break;
  }

  const days: PostingDay[] = [];
  let total14 = 0;
  let maxCount = 0;
  for (let i = 13; i >= 0; i--) {
    const d = jstDayStr(i);
    const c = countOf(d);
    total14 += c;
    if (c > maxCount) maxCount = c;
    days.push({ date: d, posted: c > 0, count: c });
  }
  const avgPerDay = Math.round((total14 / 14) * 10) / 10;

  let lastPostedDate: string | null = null;
  for (let i = 0; i < 400; i++) {
    const d = jstDayStr(i);
    if (has(d)) { lastPostedDate = d; break; }
  }

  return { days, streak, postedToday, todayCount, total14, avgPerDay, maxCount, lastPostedDate };
}
