// report-goal — zeroguri-report（ログイン無しの内部レポート）から
// クリエイター個別の「1日あたり目標投稿本数」を Supabase に保存する。
// 認証の代わりに合言葉(REPORT_GOAL_SECRET)で保護。verify_jwt=false。
// 保存先 profiles.daily_post_goal_min / _max は tracker のランキングで公開表示される。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin } from "../_shared/supabase.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return error("method not allowed", 405);
  try {
    const secret = Deno.env.get("REPORT_GOAL_SECRET");
    if (!secret) return error("REPORT_GOAL_SECRET not configured", 500);

    const body = (await req.json().catch(() => null)) as
      | { pass?: string; userId?: string; min?: unknown; max?: unknown }
      | null;
    if (!body) return error("invalid body", 400);
    if ((body.pass ?? "") !== secret) return error("forbidden: wrong passphrase", 403);

    const userId = String(body.userId ?? "");
    if (!UUID_RE.test(userId)) return error("invalid userId", 400);

    // 0 / 空 / 負 → 未設定(null) に正規化
    const norm = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    const min = norm(body.min);
    const max = norm(body.max);

    // profiles への service_role 直接UPDATE権限が無いため SECURITY DEFINER の RPC 経由で更新。
    const db = admin();
    const { error: upErr } = await db.rpc("set_daily_post_goals", {
      p_user_id: userId,
      p_min: min,
      p_max: max,
    });
    if (upErr) return error(upErr.message, 500);

    return json({ ok: true, userId, min, max });
  } catch (e) {
    return error(String(e), 500);
  }
});
