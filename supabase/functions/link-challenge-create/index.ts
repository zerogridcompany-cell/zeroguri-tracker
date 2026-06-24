// link-challenge-create — 所有確認チャレンジ発行（verify_jwt=true）
// YouTube / Instagram は OAuth/審査なしで連携する。一度きりの nonce を発行し、
// ユーザーにチャンネル概要欄 / IG bio へ貼らせ、link-challenge-verify で公開読み取り照合する。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { randomState } from "../_shared/crypto.ts";
import { admin, getUser } from "../_shared/supabase.ts";

const INSTRUCTIONS: Record<string, string> = {
  youtube: "YouTube Studio → カスタマイズ → 基本情報の「説明」にこのコードを貼り付けて保存してください（確認後は削除可）。",
  tiktok: "TikTok プロフィールを編集 → 自己紹介（bio）にこのコードを貼り付けて保存してください（確認後は削除可）。",
  instagram: "Instagram プロフィール編集 → 自己紹介（bio）にこのコードを貼り付けて保存してください（確認後は削除可）。",
};

const SUPPORTED = ["youtube", "tiktok", "instagram"];

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const platform = body.platform as string;
    const identifier = (body.identifier as string)?.trim();
    if (!SUPPORTED.includes(platform)) {
      return error("platform must be youtube / tiktok / instagram", 400);
    }
    if (!identifier) return error("identifier required (@handle / channelId / username)", 400);

    // 既存の確認コードがあれば再利用（再発行しても貼り直し不要にする）。
    const { data: existing } = await admin()
      .from("pending_link_challenges")
      .select("nonce")
      .eq("user_id", user.id).eq("platform", platform).eq("identifier", identifier)
      .maybeSingle();

    const nonce = (existing?.nonce as string | undefined) ?? ("zeroguri-verify-" + randomState().slice(0, 10));

    if (!existing) {
      const { error: upErr } = await admin()
        .from("pending_link_challenges")
        .upsert(
          { user_id: user.id, platform, identifier, nonce },
          { onConflict: "user_id,platform,identifier" },
        );
      if (upErr) return error(upErr.message, 500);
    }

    return json({ nonce, platform, identifier, instructions: INSTRUCTIONS[platform] });
  } catch (e) {
    return error(String(e), 500);
  }
});
