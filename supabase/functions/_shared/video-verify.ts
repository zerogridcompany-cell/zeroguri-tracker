// _shared/video-verify.ts — 動画URLの正規化＆「投稿者が連携アカウント本人か」の検証。
// register-tracked-video（即トラッキング）と submit-manual-video（提出→承認）で共用。

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** TikTok の vt./vm. 短縮共有リンクを canonical（/@user/video/ID）へ解決。失敗時 null。 */
export async function expandTikTokShort(s?: string): Promise<string | null> {
  if (!s || !/vt\.tiktok\.com|vm\.tiktok\.com/.test(s)) return null;
  try {
    const r = await fetch(s.trim(), { redirect: "follow", headers: { "User-Agent": UA } });
    return r.url && /tiktok\.com\/.+\/video\/\d+/.test(r.url) ? r.url : null;
  } catch {
    return null;
  }
}

/** ハンドル比較キー: 先頭@除去 + 小文字化 + trim。 */
export function handleKey(h?: string | null): string {
  return (h ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function resolveAuthorHandle(platform: string, canonicalUrl: string | null): Promise<string | null> {
  if (!canonicalUrl) return null;
  try {
    let endpoint: string;
    if (platform === "youtube") {
      endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    } else if (platform === "tiktok") {
      endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
    } else {
      return null;
    }
    const r = await fetch(endpoint, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { author_url?: string } | null;
    const m = (j?.author_url ?? "").match(/\/@([^/?#]+)/);
    return m ? safeDecode(m[1]) : null;
  } catch {
    return null;
  }
}

async function ytChannelIdFromVideo(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"channelId":"(UC[\w-]+)"/) ||
      html.match(/"externalChannelId":"(UC[\w-]+)"/) ||
      html.match(/channel\/(UC[\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function ytChannelIdFromHandle(handle: string | null): Promise<string | null> {
  const h = (handle ?? "").trim().replace(/^@+/, "");
  if (!h) return null;
  try {
    const r = await fetch(`https://www.youtube.com/@${encodeURIComponent(h)}`, {
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"externalId":"(UC[\w-]+)"/) ||
      html.match(/"channelId":"(UC[\w-]+)"/) ||
      html.match(/channel\/(UC[\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Instagram モバイル private API 用 UA（feed/user ページングに必要）。
const IG_MOBILE_UA =
  "Instagram 219.0.0.12.117 Android (30/11; 480dpi; 1080x2148; samsung; SM-G991B; o1s; exynos2100; en_US; 314665256)";
const IG_APP_ID = "936619743392459";
// 連携アカウントの「最近の投稿」を何件まで遡って所有確認するか。
// www の web_profile_info（先頭12件）＋ i.instagram の feed/user ページング（無認証だと ~2ページで 401）で
// だいたい直近 ~30件をカバーする。投稿直後に追加する想定なので実運用ではほぼ全件これで足りる。
const IG_SCAN_LIMIT = 60;
const IG_FEED_MAX_PAGES = 4;

type IgPost = { shortcode: string; publishedMs: number | null };

/** www の web_profile_info を叩いて username / userId / 先頭メディアを取得。失敗時は profileOk=false。 */
async function igProfileLookup(
  handle: string,
): Promise<{ profileOk: boolean; username: string | null; userId: string | null; posts: IgPost[]; totalCount: number | null }> {
  const h = handleKey(handle);
  const empty = { profileOk: false, username: null, userId: null, posts: [] as IgPost[], totalCount: null };
  if (!h) return empty;
  // web_profile_info は基本 200 で返るが、稀なレート制限に備えて 1 回だけ再試行。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        { headers: { "User-Agent": UA, "x-ig-app-id": IG_APP_ID, "Accept-Language": "ja,en;q=0.8" } },
      );
      if (!r.ok) continue;
      const j = (await r.json().catch(() => null)) as
        | { data?: { user?: { id?: string; username?: string; edge_owner_to_timeline_media?: { count?: number; edges?: { node?: { shortcode?: string; taken_at_timestamp?: number } }[] } } } }
        | null;
      const user = j?.data?.user;
      if (!user) continue;
      const tl = user.edge_owner_to_timeline_media;
      const posts: IgPost[] = (tl?.edges ?? [])
        .map((e) => e?.node)
        .filter((n): n is { shortcode?: string; taken_at_timestamp?: number } => !!n?.shortcode)
        .map((n) => ({ shortcode: n.shortcode as string, publishedMs: n.taken_at_timestamp ? n.taken_at_timestamp * 1000 : null }));
      return { profileOk: true, username: user.username ?? null, userId: user.id ?? null, posts, totalCount: tl?.count ?? null };
    } catch {
      /* 次の試行へ */
    }
  }
  return empty;
}

/** i.instagram の feed/user を max_id でページングし、最大 IG_FEED_MAX_PAGES / IG_SCAN_LIMIT 件まで遡る。 */
async function igFeedPosts(userId: string, limit: number): Promise<IgPost[]> {
  const out: IgPost[] = [];
  let maxId = "";
  for (let page = 0; page < IG_FEED_MAX_PAGES && out.length < limit; page++) {
    try {
      const url = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=33` + (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
      const r = await fetch(url, { headers: { "User-Agent": IG_MOBILE_UA, "x-ig-app-id": IG_APP_ID } });
      if (!r.ok) break; // 無認証だと数ページで 401。そこまでの収集分で判定する。
      const j = (await r.json().catch(() => null)) as
        | { items?: { code?: string; taken_at?: number }[]; more_available?: boolean; next_max_id?: string }
        | null;
      if (!j?.items?.length) break;
      for (const it of j.items) {
        if (it?.code) out.push({ shortcode: it.code, publishedMs: it.taken_at ? it.taken_at * 1000 : null });
      }
      if (!j.more_available || !j.next_max_id) break;
      maxId = j.next_max_id;
    } catch {
      break;
    }
  }
  return out;
}

type IgVerdict =
  | { kind: "owned"; publishedMs: number | null }
  | { kind: "not_found"; profileOk: true }
  | { kind: "profile_unreachable" };

/**
 * 連携アカウント（handle）の最近の投稿 ~IG_SCAN_LIMIT 件を走査し、shortcode が本人の投稿かを判定。
 * 旧来の embed スクレイピングは Instagram 側が中身の無い JS シェルを返すようになり死んでいるため使わない。
 */
async function igVerifyOwnership(handle: string, shortcode: string): Promise<IgVerdict> {
  if (!shortcode) return { kind: "profile_unreachable" };
  const prof = await igProfileLookup(handle);
  if (!prof.profileOk) return { kind: "profile_unreachable" };

  const found = prof.posts.find((p) => p.shortcode === shortcode);
  if (found) return { kind: "owned", publishedMs: found.publishedMs };

  // 先頭12件に無ければ feed/user を遡って探す（投稿頻度の高いクリップ垢でも数日分はカバー）。
  if (prof.userId) {
    const more = await igFeedPosts(prof.userId, IG_SCAN_LIMIT);
    const hit = more.find((p) => p.shortcode === shortcode);
    if (hit) return { kind: "owned", publishedMs: hit.publishedMs };
  }
  return { kind: "not_found", profileOk: true };
}

async function fetchYouTubePublishedMs(url: string | null): Promise<number | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"publishDate":"([^"]+)"/) ||
      html.match(/"uploadDate":"([^"]+)"/) ||
      html.match(/itemprop="datePublished"\s+content="([^"]+)"/);
    if (!m) return null;
    const t = Date.parse(m[1]);
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

function tiktokPublishedMs(contentId: string): number | null {
  if (!/^\d{6,25}$/.test(contentId)) return null;
  try {
    return Number(BigInt(contentId) >> 32n) * 1000;
  } catch {
    return null;
  }
}

/** 入力（ID or URL, ?si= 等付与あり）→ クリーンな content_id と正規 URL。 */
export function normalizeVideo(platform: string, rawId?: string, rawUrl?: string): { contentId: string; url: string | null } {
  const cands = [rawUrl, rawId].filter((x) => x && String(x).trim()).map((x) => String(x).trim());

  if (platform === "youtube") {
    for (const c of cands) {
      const m = c.match(/(?:v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([0-9A-Za-z_-]{11})/);
      if (m) return { contentId: m[1], url: `https://www.youtube.com/watch?v=${m[1]}` };
      if (/^[0-9A-Za-z_-]{11}$/.test(c)) return { contentId: c, url: `https://www.youtube.com/watch?v=${c}` };
    }
  } else if (platform === "tiktok") {
    for (const c of cands) {
      if (c.startsWith("http")) {
        const clean = c.split("?")[0];
        const m = clean.match(/\/video\/(\d+)/);
        return { contentId: m ? m[1] : clean, url: clean };
      }
    }
  } else if (platform === "instagram") {
    for (const c of cands) {
      const m = c.match(/\/(?:reels?|p|tv)\/([0-9A-Za-z_-]+)/);
      if (m) return { contentId: m[1], url: `https://www.instagram.com/reel/${m[1]}/` };
    }
    for (const c of cands) {
      if (!c.startsWith("http") && /^[0-9A-Za-z_-]{5,}$/.test(c)) {
        return { contentId: c, url: `https://www.instagram.com/reel/${c}/` };
      }
    }
  }
  const first = cands[0] ?? "";
  return { contentId: (rawId?.trim() || first), url: rawUrl?.trim() || (first.startsWith("http") ? first : null) };
}

/** URL/入力からプラットフォームを判定（不明なら null）。 */
export function detectPlatform(s: string): "youtube" | "tiktok" | "instagram" | null {
  const v = (s || "").toLowerCase();
  if (v.includes("youtube.com") || v.includes("youtu.be")) return "youtube";
  if (v.includes("tiktok.com")) return "tiktok";
  if (v.includes("instagram.com")) return "instagram";
  return null;
}

export type VerifyResult =
  | { ok: true; publishedMs: number | null }
  | { ok: false; status: number; message: string };

/**
 * 投稿者が連携アカウント本人か検証し、投稿日時(ms)を返す。
 * 「所有を確証」「別人だと確証」「判定不能」の3値で扱い、本人の動画を取りこぼさない
 * （判定不能は 403 ではなく再試行できるエラーにする）。
 */
export async function verifyOwnershipAndDate(
  platform: string,
  handle: string | null,
  contentId: string,
  url: string | null,
): Promise<VerifyResult> {
  if (platform === "youtube") {
    const author = await resolveAuthorHandle("youtube", url);
    let owned = !!author && handleKey(author) === handleKey(handle);
    let definitelyDifferent = false;
    if (!owned) {
      const [vidCh, accCh] = await Promise.all([ytChannelIdFromVideo(url), ytChannelIdFromHandle(handle)]);
      if (vidCh && accCh) {
        if (vidCh === accCh) owned = true;
        else definitelyDifferent = true;
      }
    }
    if (owned) return { ok: true, publishedMs: await fetchYouTubePublishedMs(url) };
    if (definitelyDifferent) {
      return { ok: false, status: 403, message: `この動画は連携アカウント（${handle}）の投稿ではありません${author ? `。投稿者: @${author}` : ""}` };
    }
    return { ok: false, status: 400, message: "動画の投稿者を確認できませんでした。公開中の動画URLか、少し時間をおいて再度お試しください" };
  }

  if (platform === "tiktok") {
    const author = await resolveAuthorHandle("tiktok", url);
    if (!author) {
      return { ok: false, status: 400, message: "動画の投稿者を確認できませんでした。公開中の動画URLか、少し時間をおいて再度お試しください" };
    }
    if (handleKey(author) !== handleKey(handle)) {
      return { ok: false, status: 403, message: `この動画は連携アカウント（${handle}）の投稿ではありません。投稿者: @${author}` };
    }
    return { ok: true, publishedMs: tiktokPublishedMs(contentId) };
  }

  if (platform === "instagram") {
    const v = await igVerifyOwnership(handle ?? "", contentId);
    if (v.kind === "owned") return { ok: true, publishedMs: v.publishedMs };
    if (v.kind === "not_found") {
      // プロフィールは読めたが、遡れた範囲の投稿にこの動画が無い。
      // 「本人の古い投稿」か「本人以外の動画」かはここでは断定できないため、再追加を促す案内に留める。
      return {
        ok: false,
        status: 422,
        message:
          `連携アカウント（${handle}）の最近の投稿の中にこの動画が見つかりませんでした。ご自身のアカウントで投稿した動画かご確認ください。投稿直後の場合は反映まで数分かかることがあるため、少し時間をおいて再度お試しください`,
      };
    }
    // profile_unreachable: プロフィール取得に失敗（レート制限など）。再試行で解消し得る。
    return { ok: false, status: 503, message: "動画の投稿者を確認できませんでした。公開アカウントの投稿か、少し時間をおいて再度お試しください" };
  }

  return { ok: true, publishedMs: null };
}
