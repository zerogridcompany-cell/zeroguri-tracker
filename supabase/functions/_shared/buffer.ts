// _shared/buffer.ts — Buffer(GraphQL) で Instagram に予約投稿/下書き。
// secret: BUFFER_TOKEN / BUFFER_CHANNEL_ID。メディアは公開URLを Buffer が取得する。

const BUFFER_API = "https://api.buffer.com/graphql";

export interface BufferPostOpts {
  text: string;
  mediaUrl: string;
  mediaType: "video" | "image";
  igType: "post" | "reel" | "story";
  platform?: string; // instagram | tiktok | youtube | ...（metadata を出し分け。未指定は instagram 互換）
  schedulingType: "notification" | "automatic";
  dueAt?: string; // ISO
  saveToDraft?: boolean;
  channelId?: string; // 投稿先 Buffer チャンネル（未指定なら環境変数の既定）
  token?: string; // 投稿に使う Buffer トークン（未指定なら環境変数の既定＝組織トークン）
}

// Buffer の PostInputMetaData をプラットフォーム別に組み立てる（introspection で確認した構造）。
function buildMetadata(opts: BufferPostOpts): Record<string, unknown> {
  const platform = (opts.platform || "instagram").toLowerCase();
  const text = opts.text ?? "";
  if (platform === "tiktok") return { tiktok: text ? { title: text.slice(0, 150) } : {} };
  // YouTube は categoryId 必須（"22" = People & Blogs を既定）。Shorts は title 必須。
  if (platform === "youtube") return { youtube: { title: text.slice(0, 100) || "動画", privacy: "public", categoryId: "22" } };
  return { instagram: { type: opts.igType, shouldShareToFeed: true } }; // instagram（既定）
}

// ambiguous=true: 送信後に応答が得られず投稿が作成された可能性がある（=自動再試行で二重投稿の恐れ）。
// postId: Buffer の投稿ID（成功時。公開後に公開URLを引いて自動トラッキングするために保存）。
export async function bufferCreatePost(
  opts: BufferPostOpts,
): Promise<{ ok: boolean; error?: string; type?: string; ambiguous?: boolean; postId?: string }> {
  const token = opts.token || Deno.env.get("BUFFER_TOKEN");
  const channelId = opts.channelId || Deno.env.get("BUFFER_CHANNEL_ID");
  if (!token || !channelId) return { ok: false, error: "投稿先のBufferチャンネルが未設定です" };
  if (!opts.mediaUrl) return { ok: false, error: "メディアURLが必要です（Instagram は画像/動画が必須）" };

  const asset = opts.mediaType === "video"
    ? { video: { url: opts.mediaUrl } }
    : { image: { url: opts.mediaUrl } };
  // 日時指定があれば customScheduled、無ければ Buffer のキューに追加（addToQueue）
  const input: Record<string, unknown> = {
    channelId,
    schedulingType: opts.schedulingType === "automatic" ? "automatic" : "notification",
    mode: opts.dueAt ? "customScheduled" : "addToQueue",
    text: opts.text ?? "",
    metadata: buildMetadata(opts),
    assets: [asset],
    saveToDraft: Boolean(opts.saveToDraft),
  };
  if (opts.dueAt) input.dueAt = opts.dueAt;

  const mutation =
    "mutation($input: CreatePostInput!){ createPost(input:$input){ __typename ... on PostActionSuccess { post { id } } ... on UnexpectedError { message } } }";
  let j: Record<string, unknown>;
  let httpOk = false;
  let httpStatus = 0;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(BUFFER_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { input } }),
      signal: ctrl.signal,
    });
    httpOk = res.ok;
    httpStatus = res.status;
    j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    // ネットワーク/DNS/TLS/タイムアウト/応答ロスト等。投稿が作成済みかどうか不明（ambiguous）。
    // 二重投稿防止のため、呼び出し側は自動再試行せず「要確認」で止める。
    return { ok: false, ambiguous: true, error: "Buffer 応答なし: " + String(e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
  if (j.errors) return { ok: false, error: "Buffer: " + JSON.stringify(j.errors).slice(0, 300) };
  const result = (j.data as { createPost?: { __typename?: string; message?: string; post?: { id?: string } } } | undefined)?.createPost;
  // 成功は PostActionSuccess の明示一致のみ
  if (result?.__typename === "PostActionSuccess") {
    return { ok: true, type: result.__typename, postId: result.post?.id };
  }
  // 既知のエラー型 → 確定的失敗（再試行可）
  if (result) {
    return { ok: false, error: "Buffer: " + (result.message ?? `投稿に失敗しました（${result.__typename}）`) };
  }
  // createPost を解釈できない（HTTPエラーHTML / 想定外JSON / data:null 等）
  if (!httpOk) return { ok: false, error: `Buffer: HTTP ${httpStatus}` }; // 4xx/5xx → ほぼ未作成（確定的失敗）
  return { ok: false, ambiguous: true, error: "Buffer応答を解釈できません（要確認）" }; // 2xx だが不明 → 二重投稿防止で needs_review
}
