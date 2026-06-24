// link-challenge-verify — 連携作成（verify_jwt=true）
// 本人確認: link-challenge-create で発行した確認コード(nonce)が、対象アカウントの
// プロフィール（YouTube概要欄 / TikTok bio / Instagram bio）に貼られているかを
// 公開ページの取得で照合する。一致した場合のみ linked_accounts を connected で作成。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, audit, getUser } from "../_shared/supabase.ts";

const PLATFORMS = ["youtube", "tiktok", "instagram"];
const _UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function handleKey(h?: string | null): string {
  return (h ?? "").trim().replace(/^@+/, "").toLowerCase();
}

/**
 * TikTok の bio(signature) を 3rd-party API（tikwm）経由で取得。取得失敗は null。
 * www.tiktok.com の公開ページはデータセンターIPからだと captcha/403 で中身が取れない
 * （Supabase edge は Sydney リージョン）ため、ページ HTML スクレイプは使わない。
 * 空 bio は ""（空文字）を返す＝「取得できたがコード無し」として扱える。
 */
async function tiktokSignature(handle: string): Promise<string | null> {
  const endpoints = [
    `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`,
    `https://tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": _UA, "Accept": "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const j = (await r.json().catch(() => null)) as { code?: number; data?: { user?: { signature?: string } } } | null;
      if (j?.code !== 0) continue;
      const sig = j?.data?.user?.signature;
      if (typeof sig === "string") return sig;
    } catch {
      /* 次のエンドポイントを試す */
    }
  }
  return null;
}

/** プロフィールの自己紹介に nonce が含まれるか公開ソースで照合。取得失敗は null（判定保留）。 */
async function bioContainsNonce(platform: string, identifier: string, nonce: string): Promise<boolean | null> {
  const h = handleKey(identifier);
  try {
    // Instagram はログアウトの公開HTMLに bio が出ないため、web_profile_info API の biography を見る。
    if (platform === "instagram") {
      const r = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        { headers: { "User-Agent": _UA, "x-ig-app-id": "936619743392459", "Accept-Language": "ja,en;q=0.8" } },
      );
      if (!r.ok) return null;
      const j = (await r.json().catch(() => null)) as { data?: { user?: { biography?: string } } } | null;
      const bio = j?.data?.user?.biography;
      if (typeof bio !== "string") return null;
      return bio.includes(nonce);
    }

    // TikTok はデータセンターIPからのページ取得が captcha/403 で全滅するため tikwm 経由で bio を読む。
    if (platform === "tiktok") {
      const sig = await tiktokSignature(h);
      if (sig === null) return null; // 取得失敗 → 判定保留（再試行可）
      return sig.includes(nonce);
    }

    // YouTube=概要欄は公開ページの埋め込みデータ（ytInitialData）に含まれる。
    const r = await fetch(`https://www.youtube.com/@${h}/about`, {
      headers: { "User-Agent": _UA, "Accept-Language": "ja,en;q=0.8" },
    });
    if (!r.ok) return null;
    const html = await r.text();
    return html.includes(nonce);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const platform = String(body.platform ?? "");
    const identifier = (body.identifier as string)?.trim();
    const campaignId = (body.campaign_id as string)?.trim();
    if (!PLATFORMS.includes(platform)) return error("platform must be youtube/tiktok/instagram", 400);
    if (!identifier) return error("identifier (@handle / username) required", 400);
    if (!campaignId) return error("campaign_id required", 400);

    // 確認コード（nonce）を取得。無ければ先に発行が必要。
    const { data: ch } = await admin()
      .from("pending_link_challenges")
      .select("id, nonce")
      .eq("user_id", user.id).eq("platform", platform).eq("identifier", identifier)
      .maybeSingle();
    if (!ch?.nonce) {
      return error("先に確認コードを発行してください", 400);
    }

    // 本人確認: プロフィールに確認コードが貼られているか照合
    const found = await bioContainsNonce(platform, identifier, ch.nonce as string);
    if (found === null) {
      return error(
        "プロフィールを確認できませんでした。公開アカウントかご確認のうえ、少し時間をおいて再度お試しください",
        502,
      );
    }
    if (!found) {
      return error(
        "確認コードが見つかりませんでした。プロフィール（bio / 概要欄）に貼り付けて保存したかご確認ください",
        400,
      );
    }

    // 照合OK → 連携作成（本人確認済み）
    const handle = identifier.startsWith("@") ? identifier : "@" + identifier;
    const nowIso = new Date().toISOString();

    const { data: account, error: upErr } = await admin()
      .from("linked_accounts")
      .upsert(
        {
          user_id: user.id,
          campaign_id: campaignId,
          platform,
          platform_user_id: identifier,
          handle,
          is_new_account: true,
          status: "connected",
          ownership_method: "bio_challenge",
          ownership_verified_at: nowIso,
          connected_at: nowIso,
        },
        { onConflict: "campaign_id,platform,platform_user_id" },
      )
      .select()
      .single();
    if (upErr || !account) return error(upErr?.message ?? "link failed", 500);

    await admin().from("pending_link_challenges").delete().eq("id", ch.id);
    await audit(account.id, "link-challenge-verify", "read", { platform, method: "bio_challenge" });

    return json({ ok: true, linked_account: account });
  } catch (e) {
    return error(String(e), 500);
  }
});
