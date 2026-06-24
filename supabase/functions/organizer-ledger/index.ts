// organizer-ledger — ペイアウト済みログ（verify_jwt=true / オーガナイザー専用）
// 動画1本ごとに「もう支払い済み（計上対象外）」の台帳を返す。案件別・ユーザー別で絞れる。
// body.action="reset" + id でその1本の台帳を削除 → 再追加時に最初から計上される。
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

    const body = await req.json().catch(() => ({}));

    // リセット / 取り消し: その「支払い」を丸ごと取り消す（どちらのタブからでも同じ動き＝完全同期）。
    // = その支払いに含まれる動画の台帳をすべて削除（全部計上し直し）＋ 振込履歴からも削除。
    // （他の支払いの履歴には一切触らない＝リセットしたものだけ消える）
    if (body.action === "reset" || body.action === "void_request") {
      const requestId = ((body.requestId ?? body.request_id) as string | undefined)?.trim();
      const ledgerId = (body.id as string | undefined)?.trim();

      if (requestId) {
        await db.from("video_payout_ledger").delete().eq("last_payout_request_id", requestId);
        const { error: prErr } = await db.from("payout_requests").delete().eq("id", requestId);
        if (prErr) return error(prErr.message, 500);
        return json({ ok: true });
      }
      // 振込にひも付かない台帳行（レアケース）は単体で削除
      if (ledgerId && !ledgerId.startsWith("req:")) {
        const { error: delErr } = await db.from("video_payout_ledger").delete().eq("id", ledgerId);
        if (delErr) return error(delErr.message, 500);
        return json({ ok: true });
      }
      return error("requestId required", 400);
    }

    // 一覧: 動画ごとの台帳 ＋ 台帳が無い支払い（古い支払い等）も出す → どちらのタブからでも管理できる
    const [ledRes, reqRes, campRes, profRes] = await Promise.all([
      db.from("video_payout_ledger").select("*").order("last_paid_at", { ascending: false }),
      db.from("payout_requests").select("*").eq("status", "paid").order("paid_at", { ascending: false }),
      db.from("campaigns").select("id, title"),
      db.from("profiles").select("user_id, internal_id, name_kanji, last_name_kanji, first_name_kanji"),
    ]);

    const cmap = new Map<string, string>();
    for (const c of campRes.data ?? []) cmap.set(c.id as string, c.title as string);
    const pmap = new Map<string, Record<string, unknown>>();
    for (const p of profRes.data ?? []) pmap.set(p.user_id as string, p);
    const campOf = (id: string | null) => (id ? (cmap.get(id) ?? "（削除済み案件）") : "—");

    const ledgerRows = ledRes.data ?? [];
    const referencedReqIds = new Set(
      ledgerRows.map((r) => r.last_payout_request_id as string | null).filter(Boolean),
    );

    const videoEntries = ledgerRows.map((r) => ({
      id: r.id,
      kind: "video",
      requestId: (r.last_payout_request_id as string | null) ?? null,
      campaignId: r.campaign_id,
      campaign: campOf(r.campaign_id as string | null),
      userId: r.user_id,
      userName: mkName(pmap.get(r.user_id as string)),
      internalId: (pmap.get(r.user_id as string)?.internal_id as string | null) ?? null,
      platform: r.platform,
      handle: r.handle,
      contentId: r.content_id,
      title: r.title,
      paidViews: num(r.paid_views),
      paidAmount: num(r.paid_amount),
      lastPaidAt: r.last_paid_at,
    }));

    // 台帳にひも付かない支払い済みリクエスト（旧データ等）を request 単位で出す
    const orphanEntries = (reqRes.data ?? [])
      .filter((rq) => !referencedReqIds.has(rq.id as string))
      .map((rq) => ({
        id: `req:${rq.id}`,
        kind: "request",
        requestId: rq.id,
        campaignId: rq.campaign_id,
        campaign: campOf(rq.campaign_id as string | null),
        userId: rq.user_id,
        userName: mkName(pmap.get(rq.user_id as string)),
        internalId: (pmap.get(rq.user_id as string)?.internal_id as string | null) ?? null,
        platform: null,
        handle: null,
        contentId: null,
        title: null,
        paidViews: 0,
        paidAmount: num(rq.amount),
        lastPaidAt: rq.paid_at,
      }));

    return json({ entries: [...videoEntries, ...orphanEntries] });
  } catch (e) {
    return error(String(e), 500);
  }
});
