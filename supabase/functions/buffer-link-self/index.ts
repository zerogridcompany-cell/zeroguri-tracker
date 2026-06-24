// buffer-link-self — 本人の連携アカウントを、組織Bufferの接続済みチャンネルに紐付ける（verify_jwt=true / クリエイター本人）
// 講義の手順で自分のアカウントをBufferに接続したあと、本人がこれを実行すると予約投稿が有効になる。
// 安全性: user_id でフィルタし本人の linked_accounts のみ対象。突合は一意な handle 一致のみ（誤ルーティング防止）。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

interface Ch { id: string; service: string; name?: string | null; displayName?: string | null; isDisconnected?: boolean }

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    const token = Deno.env.get("BUFFER_TOKEN");
    const orgId = Deno.env.get("BUFFER_ORG_ID");
    if (!token || !orgId) return error("Buffer not configured", 500);

    const query = `{ channels(input: { organizationId: "${orgId}" }) { id service name displayName isDisconnected } }`;
    const res = await fetch("https://api.buffer.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const j = await res.json().catch(() => ({}));
    const channels = (j?.data?.channels ?? null) as Ch[] | null;
    if (!Array.isArray(channels)) return error("Buffer: " + JSON.stringify(j).slice(0, 300), 502);

    const norm = (s: string | null | undefined) => (s ?? "").replace(/^@/, "").trim().toLowerCase();
    const connectedIds = new Set(channels.filter((c) => !c.isDisconnected).map((c) => c.id));
    const { data: accounts } = await db
      .from("linked_accounts").select("id, platform, handle, buffer_channel_id").eq("user_id", user.id);

    let linked = 0;
    for (const a of accounts ?? []) {
      const cur = (a.buffer_channel_id as string | null) ?? null;
      if (cur && connectedIds.has(cur)) { linked++; continue; }
      const matches = channels.filter((c) =>
        c.service === a.platform && !c.isDisconnected && norm(c.name) !== "" && norm(c.name) === norm(a.handle as string));
      const cid = matches.length === 1 ? matches[0].id : null; // 曖昧は紐付けない
      if (cid !== cur) await db.from("linked_accounts").update({ buffer_channel_id: cid }).eq("id", a.id);
      if (cid) linked++;
    }
    return json({ ok: true, linkedAccounts: linked });
  } catch (e) {
    return error(String(e), 500);
  }
});
