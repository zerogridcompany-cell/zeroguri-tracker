// organizer-members — オーガナイザー一元管理 + 詳細分析（verify_jwt=true）
// 全クリエイターの: プロフィール / 合計(再生・報酬・本数) / プラットフォーム別 / 伸びてる動画TOP。
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

    // オーガナイザー検証
    const { data: me } = await db.from("app_users").select("email").eq("id", user.id).maybeSingle();
    const email = me?.email;
    if (!email) return error("forbidden", 403);
    const { data: orgRow } = await db.from("organizer_emails").select("email").ilike("email", email).maybeSingle();
    if (!orgRow) return error("forbidden", 403);

    const [profilesRes, totalsRes, platformsRes, videosRes, accountsRes, postingRes] = await Promise.all([
      db.from("profiles").select("*"),
      db.from("v_user_totals").select("*"),
      db.from("v_user_platform").select("*"),
      db.from("tracked_videos")
        .select("id, content_id, title, platform, url, last_views, linked_accounts!inner(user_id, handle)")
        .order("last_views", { ascending: false })
        .limit(800),
      db.from("linked_accounts").select("user_id, platform, handle, status"),
      db.from("v_user_posting_days").select("user_id, posted_date, posts"),
    ]);

    // ユーザー→投稿日(JST)の集合（毎日投稿トラッキング）と、日別の投稿本数（date→本数）
    const postingMap = new Map<string, Set<string>>();
    const postingCountMap = new Map<string, Map<string, number>>();
    for (const r of postingRes.data ?? []) {
      const uid = r.user_id as string;
      const date = r.posted_date as string;
      const set = postingMap.get(uid) ?? new Set<string>();
      set.add(date);
      postingMap.set(uid, set);
      const cm = postingCountMap.get(uid) ?? new Map<string, number>();
      cm.set(date, (cm.get(date) ?? 0) + Number(r.posts ?? 0));
      postingCountMap.set(uid, cm);
    }

    // ユーザー→連携アカウント（platform/handle）。詳細画面でアカウントへ飛べるように。
    const accountsMap = new Map<string, { platform: string; handle: string | null; status: string | null }[]>();
    for (const a of accountsRes.data ?? []) {
      const arr = accountsMap.get(a.user_id as string) ?? [];
      arr.push({ platform: a.platform as string, handle: a.handle as string | null, status: a.status as string | null });
      accountsMap.set(a.user_id as string, arr);
    }

    const totalsMap = new Map<string, Record<string, unknown>>();
    for (const t of totalsRes.data ?? []) totalsMap.set(t.user_id as string, t);

    const platformsMap = new Map<string, Record<string, unknown>[]>();
    for (const p of platformsRes.data ?? []) {
      const arr = platformsMap.get(p.user_id as string) ?? [];
      arr.push(p);
      platformsMap.set(p.user_id as string, arr);
    }

    const topMap = new Map<
      string,
      { trackedVideoId: string; title: string | null; contentId: string; platform: string; url: string | null; views: number }[]
    >();
    for (const v of videosRes.data ?? []) {
      const la = v.linked_accounts as { user_id?: string; handle?: string } | { user_id?: string; handle?: string }[] | null;
      const acc = Array.isArray(la) ? la[0] : la;
      const uid = acc?.user_id;
      if (!uid) continue;
      const arr = topMap.get(uid) ?? [];
      // 動画URL: 保存値があればそれ、無ければ platform+handle+content_id から組む
      const handle = (acc?.handle ?? "").replace(/^@/, "");
      const cid = v.content_id as string;
      let url = (v.url as string | null) ?? null;
      if (!url) {
        if (v.platform === "youtube") url = `https://www.youtube.com/watch?v=${cid}`;
        else if (v.platform === "tiktok" && handle) url = `https://www.tiktok.com/@${handle}/video/${cid}`;
        else if (v.platform === "instagram") url = `https://www.instagram.com/reel/${cid}/`;
      }
      arr.push({
        trackedVideoId: v.id as string,
        title: v.title as string | null,
        contentId: cid,
        platform: v.platform as string,
        url,
        views: num(v.last_views),
      });
      topMap.set(uid, arr); // 全動画（views降順）を保持。topVideos は先頭5件で導出。
    }

    const members = (profilesRes.data ?? []).map((p) => {
      const t = totalsMap.get(p.user_id as string);
      const lastK = p.last_name_kanji as string | null;
      const firstK = p.first_name_kanji as string | null;
      const composite = [lastK, firstK].filter(Boolean).join(" ") || (p.name_kanji as string | null);
      return {
        internalId: p.internal_id,
        userId: p.user_id,
        nameKanji: composite,
        lastNameKanji: lastK,
        firstNameKanji: firstK,
        lastNameKana: p.last_name_kana as string | null,
        firstNameKana: p.first_name_kana as string | null,
        nameKanaHalf: p.name_kana_half as string | null,
        discord: ((p.discord_display_name as string | null) || (p.discord_username as string | null)) ?? null,
        sns: { youtube: p.sns_youtube_url, tiktok: p.sns_tiktok_url, instagram: p.sns_instagram_url },
        bank: {
          bankCode: p.bank_code, bankName: p.bank_name,
          branchCode: p.branch_code, branchName: p.branch_name,
          accountType: p.account_type, accountNumber: p.account_number,
          holderKana: p.account_holder_kana,
        },
        onboarded: p.onboarded,
        accounts: accountsMap.get(p.user_id as string) ?? [],
        totals: {
          views: num(t?.total_views),
          earnings: num(t?.billable_amount),
          videos: num(t?.videos),
          activeVideos: num(t?.active_videos),
        },
        platforms: (platformsMap.get(p.user_id as string) ?? []).map((pl) => ({
          platform: pl.platform as string,
          videos: num(pl.videos),
          activeVideos: num(pl.active_videos),
          views: num(pl.total_views),
          earnings: num(pl.billable_amount),
        })),
        topVideos: (topMap.get(p.user_id as string) ?? []).slice(0, 5),
        videos: topMap.get(p.user_id as string) ?? [],
        posting: postingSummary(
          postingMap.get(p.user_id as string) ?? new Set<string>(),
          postingCountMap.get(p.user_id as string),
        ),
      };
    });

    // 報酬の多い順（ぱっと見でランキング的に）
    members.sort((a, b) => b.totals.earnings - a.totals.earnings || b.totals.views - a.totals.views);

    return json({ members });
  } catch (e) {
    return error(String(e), 500);
  }
});
