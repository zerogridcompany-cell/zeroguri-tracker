// ranking — クリエイター ランキング（verify_jwt=true / 全ログインユーザーが閲覧可）
// 稼いだ金額 と 出した再生数 のランキングを返す。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { postingSummary } from "../_shared/posting.ts";

const num = (v: unknown): number => Number(v ?? 0);

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    const [totalsRes, profilesRes, postingRes, accountsRes] = await Promise.all([
      db.from("v_user_totals").select("user_id, total_views, billable_amount, videos"),
      db.from("profiles").select("user_id, internal_id, name_kanji, last_name_kanji, first_name_kanji, daily_post_goal_min, daily_post_goal_max"),
      db.from("v_user_posting_days").select("user_id, posted_date, posts"),
      db.from("linked_accounts").select("user_id, platform, handle"),
    ]);

    // ユーザー→日別本数（JST）。行を開くと投稿状況を表示する（postingSummary は Map で本数対応）。
    const postingCountMap = new Map<string, Map<string, number>>();
    for (const r of postingRes.data ?? []) {
      const uid = r.user_id as string;
      const date = r.posted_date as string;
      const cm = postingCountMap.get(uid) ?? new Map<string, number>();
      cm.set(date, (cm.get(date) ?? 0) + Number(r.posts ?? 0));
      postingCountMap.set(uid, cm);
    }

    // ユーザー→連携アカウント（各SNSプロフィールへ飛べるように platform/handle を渡す）
    const accountsMap = new Map<string, { platform: string; handle: string | null }[]>();
    for (const a of accountsRes.data ?? []) {
      const arr = accountsMap.get(a.user_id as string) ?? [];
      arr.push({ platform: a.platform as string, handle: a.handle as string | null });
      accountsMap.set(a.user_id as string, arr);
    }

    const nameMap = new Map<
      string,
      { name: string; internalId: string | null; goalMin: number | null; goalMax: number | null }
    >();
    for (const p of profilesRes.data ?? []) {
      const composite =
        [p.last_name_kanji, p.first_name_kanji].filter(Boolean).join(" ") ||
        (p.name_kanji as string | null) ||
        (p.internal_id as string | null) ||
        "—";
      nameMap.set(p.user_id as string, {
        name: composite,
        internalId: p.internal_id as string | null,
        goalMin: (p.daily_post_goal_min as number | null) ?? null,
        goalMax: (p.daily_post_goal_max as number | null) ?? null,
      });
    }

    const list = (totalsRes.data ?? []).map((t) => {
      const meta = nameMap.get(t.user_id as string);
      return {
        userId: t.user_id as string,
        name: meta?.name ?? "—",
        internalId: meta?.internalId ?? null,
        goalMin: meta?.goalMin ?? null,
        goalMax: meta?.goalMax ?? null,
        views: num(t.total_views),
        earnings: num(t.billable_amount),
        videos: num(t.videos),
        accounts: accountsMap.get(t.user_id as string) ?? [],
        posting: postingSummary(postingCountMap.get(t.user_id as string) ?? new Map<string, number>()),
      };
    });

    const rankify = (sorted: typeof list) =>
      sorted.slice(0, 100).map((x, i) => ({ rank: i + 1, ...x }));

    const byEarnings = rankify([...list].sort((a, b) => b.earnings - a.earnings || b.views - a.views));
    const byViews = rankify([...list].sort((a, b) => b.views - a.views || b.earnings - a.earnings));

    return json({ byEarnings, byViews });
  } catch (e) {
    return error(String(e), 500);
  }
});
