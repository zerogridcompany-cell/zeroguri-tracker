// organizer-payouts — 振込管理（verify_jwt=true / オーガナイザー専用）
// 引き出しリクエスト（口座・Discord・振込額・手数料・合計）＋ ユーザー検索用の全ユーザー口座/残高。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

const num = (v: unknown): number => Number(v ?? 0);
const mkName = (p: Record<string, unknown> | undefined): string =>
  [p?.last_name_kanji, p?.first_name_kanji].filter(Boolean).join(" ") ||
  (p?.name_kanji as string | null) ||
  (p?.internal_id as string | null) ||
  "—";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    const { data: me } = await db.from("app_users").select("email").eq("id", user.id).maybeSingle();
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", me?.email ?? "___none___").maybeSingle();
    if (!org) return error("forbidden", 403);

    const [reqRes, profRes, totRes, campRes] = await Promise.all([
      db.from("payout_requests").select("*").order("requested_at", { ascending: false }),
      db.from("profiles").select(
        "user_id, internal_id, name_kanji, last_name_kanji, first_name_kanji, discord_username, discord_display_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana",
      ),
      db.from("v_user_totals").select("user_id, billable_amount"),
      db.from("campaigns").select("id, title"),
    ]);

    const pmap = new Map<string, Record<string, unknown>>();
    for (const p of profRes.data ?? []) pmap.set(p.user_id as string, p);
    const tmap = new Map<string, number>();
    for (const t of totRes.data ?? []) tmap.set(t.user_id as string, num(t.billable_amount));
    const cmap = new Map<string, string>();
    for (const c of campRes.data ?? []) cmap.set(c.id as string, c.title as string);

    const bankOf = (p: Record<string, unknown> | undefined) => ({
      bankCode: p?.bank_code ?? null, bankName: p?.bank_name ?? null,
      branchCode: p?.branch_code ?? null, branchName: p?.branch_name ?? null,
      accountType: p?.account_type ?? null, accountNumber: p?.account_number ?? null,
      holderKana: p?.account_holder_kana ?? null,
    });

    // pending を先頭に
    const reqs = (reqRes.data ?? []).slice().sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === "pending" ? -1 : 1;
    });
    const requests = reqs.map((r) => {
      const p = pmap.get(r.user_id as string);
      return {
        id: r.id, userId: r.user_id, status: r.status,
        campaignId: (r.campaign_id as string | null) ?? null,
        campaign: r.campaign_id ? (cmap.get(r.campaign_id as string) ?? "（削除済み案件）") : null,
        internalId: (p?.internal_id as string | null) ?? null,
        name: mkName(p),
        discord: ((p?.discord_display_name as string | null) || (p?.discord_username as string | null)) ?? null,
        bank: bankOf(p),
        // net = 報酬総額 − ゼログリ手数料（手数料は企業側が差し引く）
        amount: num(r.amount), fee: num(r.fee), net: Math.max(0, num(r.amount) - num(r.fee)),
        currentBalance: tmap.get(r.user_id as string) ?? 0,
        requestedAt: r.requested_at, paidAt: r.paid_at,
      };
    });

    // 検索用: 全ユーザーの口座・残高
    const users = (profRes.data ?? []).map((p) => ({
      userId: p.user_id, internalId: p.internal_id, name: mkName(p),
      discord: ((p.discord_display_name as string | null) || (p.discord_username as string | null)) ?? null,
      bank: bankOf(p), balance: tmap.get(p.user_id as string) ?? 0,
    }));

    return json({ requests, users });
  } catch (e) {
    return error(String(e), 500);
  }
});
