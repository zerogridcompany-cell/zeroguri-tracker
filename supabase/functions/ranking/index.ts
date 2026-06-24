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

    const [totalsRes, profilesRes, postingRes] = await Promise.all([
      db.from("v_user_totals").select("user_id, total_views, billable_amount, videos"),
      db.from("profiles").select("user_id, internal_id, name_kanji, last_name_kanji, first_name_kanji"),
      db.from("v_user_posting_days").select("user_id, posted_date"),
    ]);

    // ユーザー→投稿日(JST)の集合（毎日投稿トラッキング）。ランキング行を開くと投稿状況を表示する。
    const postingMap = new Map<string, Set<string>>();
    for (const r of postingRes.data ?? []) {
      const uid = r.user_id as string;
      const set = postingMap.get(uid) ?? new Set<string>();
      set.add(r.posted_date as string);
      postingMap.set(uid, set);
    }

    const nameMap = new Map<string, { name: string; internalId: string | null }>();
    for (const p of profilesRes.data ?? []) {
      const composite =
        [p.last_name_kanji, p.first_name_kanji].filter(Boolean).join(" ") ||
        (p.name_kanji as string | null) ||
        (p.internal_id as string | null) ||
        "—";
      nameMap.set(p.user_id as string, { name: composite, internalId: p.internal_id as string | null });
    }

    const list = (totalsRes.data ?? []).map((t) => {
      const meta = nameMap.get(t.user_id as string);
      return {
        userId: t.user_id as string,
        name: meta?.name ?? "—",
        internalId: meta?.internalId ?? null,
        views: num(t.total_views),
        earnings: num(t.billable_amount),
        videos: num(t.videos),
        posting: postingSummary(postingMap.get(t.user_id as string) ?? new Set<string>()),
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
