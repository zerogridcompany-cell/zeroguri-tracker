// organizer-summary — オーガナイザー集計（verify_jwt=true）
// 主催案件ごとに、参加クリエイターの再生数・確定報酬を集計して返す。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

const num = (v: unknown): number => Number(v ?? 0);

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    // オーガナイザー検証（全案件を返すため必須）
    const { data: me } = await db.from("app_users").select("email").eq("id", user.id).maybeSingle();
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", me?.email ?? "___none___").maybeSingle();
    if (!org) return error("forbidden", 403);

    // 全案件を表示（誰が作成したかに関わらず、オーガナイザーは全案件を一元管理）
    const { data: campaigns, error: cErr } = await db
      .from("campaigns")
      .select("id, title, status, unit_price, cap_default, collection_start_date, created_at")
      .order("created_at", { ascending: false });
    if (cErr) return error(cErr.message, 500);

    const ids = (campaigns ?? []).map((c) => c.id as string);
    let creators: Record<string, unknown>[] = [];
    if (ids.length) {
      const { data, error: crErr } = await db
        .from("v_campaign_creators")
        .select("*")
        .in("campaign_id", ids);
      if (crErr) return error(crErr.message, 500);
      creators = data ?? [];
    }

    const byCampaign = new Map<string, Record<string, unknown>[]>();
    for (const cr of creators) {
      const cid = cr.campaign_id as string;
      const arr = byCampaign.get(cid) ?? [];
      arr.push(cr);
      byCampaign.set(cid, arr);
    }

    // 案件の進捗（予算キャップ）
    const progMap = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data: prog } = await db.from("v_campaign_progress").select("*").in("campaign_id", ids);
      for (const p of prog ?? []) progMap.set(p.campaign_id as string, p);
    }

    const out = (campaigns ?? []).map((c) => {
      const prog = progMap.get(c.id as string);
      const crs = (byCampaign.get(c.id as string) ?? []).map((cr) => ({
        handle: cr.handle as string | null,
        platform: cr.platform as string,
        email: cr.creator_email as string | null,
        videos: num(cr.videos),
        activeVideos: num(cr.active_videos),
        totalViews: num(cr.total_views),
        billableAmount: num(cr.billable_amount),
      }));
      const totalBillable = crs.reduce((s, x) => s + x.billableAmount, 0);
      const totalViews = crs.reduce((s, x) => s + x.totalViews, 0);
      const uniqueCreators = new Set(crs.map((x) => x.email ?? x.handle)).size;
      return {
        campaignId: c.id,
        title: c.title,
        status: c.status,
        // 編集フォーム用の現在値
        unitPrice: num(c.unit_price),
        capDefault: num(c.cap_default),
        collectionStartDate: (c.collection_start_date as string | null) ?? null,
        creatorCount: uniqueCreators,
        totalViews,
        // 案件合計は確定台帳ベース（counted＝credited×unit_price、キャップ反映）に統一。
        // 内訳(creators)は contribution（生）なので、合計は prog 優先でズレを防ぐ。
        totalBillableAmount: prog?.counted_amount != null
          ? num(prog.counted_amount)
          : Math.round(totalBillable * 100) / 100,
        creators: crs,
        // 予算キャップ進捗
        cap: prog?.cap_value != null
          ? { value: num(prog.cap_value), type: (prog.cap_type as string) ?? "amount", views: prog.cap_views != null ? num(prog.cap_views) : null }
          : null,
        earnedAmount: num(prog?.earned_amount),
        countedAmount: num(prog?.counted_amount),
        overAmount: num(prog?.over_amount),
        earnedViews: num(prog?.earned_views),
        progressPct: prog?.progress_pct != null ? num(prog.progress_pct) : null,
      };
    });

    const totals = {
      campaigns: out.length,
      totalViews: out.reduce((s, c) => s + c.totalViews, 0),
      totalBillableAmount: Math.round(out.reduce((s, c) => s + c.totalBillableAmount, 0) * 100) / 100,
    };

    return json({ isOrganizer: true, campaigns: out, totals });
  } catch (e) {
    return error(String(e), 500);
  }
});
