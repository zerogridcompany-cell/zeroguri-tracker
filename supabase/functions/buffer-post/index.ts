// buffer-post — Buffer(GraphQL) で Instagram に予約投稿/下書き作成（verify_jwt=true / オーガナイザー専用）
// 新API: https://api.buffer.com/graphql の createPost。Bearer は secret BUFFER_TOKEN。
// 注意: メディアURLは Buffer が取得するため公開アクセス可が必要。
//       automatic(直接公開)は IG 接続が健全である必要あり（要更新なら notification 推奨）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser, likeExact } from "../_shared/supabase.ts";

const BUFFER_API = "https://api.buffer.com/graphql";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    // 認可は検証済み JWT の email（不変）で判定。完全一致（ワイルドカード無効化）。
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", likeExact(user.email ?? "___none___")).maybeSingle();
    if (!org) return error("forbidden", 403);

    const token = Deno.env.get("BUFFER_TOKEN");
    const channelId = Deno.env.get("BUFFER_CHANNEL_ID");
    if (!token || !channelId) return error("Buffer not configured", 500);

    const b = await req.json().catch(() => ({}));
    const text = (b.text as string) ?? "";
    const dueAt = (b.dueAt as string | undefined)?.trim() || undefined; // ISO
    const mediaUrl = (b.mediaUrl as string)?.trim();
    const mediaType = (b.mediaType as string) === "video" ? "video" : "image";
    const igType = ["post", "reel", "story"].includes(b.igType as string) ? (b.igType as string) : "post";
    // 端末未リンクのため notification(リマインダー)は機能しない。既定は automatic(直接公開)。明示時のみ notification。
    const schedulingType = (b.schedulingType as string) === "notification" ? "notification" : "automatic";
    const saveToDraft = Boolean(b.saveToDraft);
    if (!mediaUrl) return error("メディアURLが必要です（Instagram は画像/動画が必須）", 400);

    const asset = mediaType === "video" ? { video: { url: mediaUrl } } : { image: { url: mediaUrl } };
    const input: Record<string, unknown> = {
      channelId,
      schedulingType,
      mode: "customScheduled",
      text,
      metadata: { instagram: { type: igType, shouldShareToFeed: true } },
      assets: [asset],
      saveToDraft,
    };
    if (dueAt) input.dueAt = dueAt;

    const mutation =
      "mutation($input: CreatePostInput!){ createPost(input:$input){ __typename ... on UnexpectedError { message } } }";
    const res = await fetch(BUFFER_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { input } }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.errors) return error("Buffer: " + JSON.stringify(j.errors).slice(0, 300), 400);
    const result = j?.data?.createPost;
    if (result?.__typename === "UnexpectedError") {
      return error("Buffer: " + (result.message ?? "投稿に失敗しました"), 400);
    }
    return json({ ok: true, type: result?.__typename ?? "Post" });
  } catch (e) {
    return error(String(e), 500);
  }
});
