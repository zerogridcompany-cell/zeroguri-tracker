// buffer-sync — 組織Bufferのチャンネルを取得して保存し、連携アカウントに紐付ける（オーガナイザー専用）。
// 主催者がBufferで各クリエイターのアカウントを接続したあとに実行する。
// 突合: Buffer channel.name(ハンドル) ↔ linked_accounts.platform_user_id/handle、かつ service==platform。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser, likeExact } from "../_shared/supabase.ts";

interface Ch {
  id: string;
  service: string;
  serviceId?: string | null;
  name?: string | null;
  displayName?: string | null;
  isDisconnected?: boolean;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", likeExact(user.email ?? "___none___")).maybeSingle();
    if (!org) return error("forbidden", 403);

    const token = Deno.env.get("BUFFER_TOKEN");
    const orgId = Deno.env.get("BUFFER_ORG_ID");
    if (!token || !orgId) return error("Buffer not configured", 500);

    const query =
      `{ channels(input: { organizationId: "${orgId}" }) { id service serviceId name displayName isDisconnected } }`;
    const res = await fetch("https://api.buffer.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const j = await res.json().catch(() => ({}));
    const channels = (j?.data?.channels ?? null) as Ch[] | null;
    if (!Array.isArray(channels)) return error("Buffer: " + JSON.stringify(j).slice(0, 300), 502);

    const nowIso = new Date().toISOString();
    for (const c of channels) {
      await db.from("buffer_channels").upsert({
        id: c.id, organization_id: orgId, service: c.service, service_id: c.serviceId ?? null,
        name: c.name ?? c.displayName ?? null, is_disconnected: Boolean(c.isDisconnected), updated_at: nowIso,
      });
    }

    // チャンネルが0件なら誤クリアを避けるため紐付けは触らない（接続後の再同期で反映）
    if (channels.length === 0) {
      return json({ ok: true, channels: [], mappedAccounts: 0, note: "Bufferにチャンネルがありません" });
    }

    // 連携アカウントへの紐付け。誤ルーティング防止のため:
    //  - 一意な handle（=channel.name）一致のみで突合。可変な displayName は使わない。
    //  - 一致が0件 or 複数なら null（fail closed）。
    //  - 既存マッピングが今も接続中チャンネルを指していれば維持（リネーム等での誤クリアを防ぐ）。
    const norm = (s: string | null | undefined) => (s ?? "").replace(/^@/, "").trim().toLowerCase();
    const connectedIds = new Set(channels.filter((c) => !c.isDisconnected).map((c) => c.id));
    // 本人が自分のBufferに自己連携済みのユーザーは org 同期で上書きしない（トークンとチャンネルの不整合防止）
    const { data: selfRows } = await db.from("user_buffer_connections").select("user_id");
    const selfSet = new Set((selfRows ?? []).map((r) => r.user_id as string));
    const { data: accounts } = await db.from("linked_accounts").select("id, platform, handle, buffer_channel_id, user_id");
    let mapped = 0;
    for (const a of accounts ?? []) {
      if (selfSet.has(a.user_id as string)) { if (a.buffer_channel_id) mapped++; continue; } // 自己連携ユーザーは触らない
      const cur = (a.buffer_channel_id as string | null) ?? null;
      if (cur && connectedIds.has(cur)) { mapped++; continue; } // 既存の有効マッピングは維持
      const matches = channels.filter((c) =>
        c.service === a.platform && !c.isDisconnected && norm(c.name) !== "" && norm(c.name) === norm(a.handle as string));
      const newCid = matches.length === 1 ? matches[0].id : null; // 曖昧は紐付けない
      if (newCid !== cur) await db.from("linked_accounts").update({ buffer_channel_id: newCid }).eq("id", a.id);
      if (newCid) mapped++;
    }

    return json({
      ok: true,
      channels: channels.map((c) => ({
        id: c.id, service: c.service, name: c.name ?? c.displayName, isDisconnected: Boolean(c.isDisconnected),
      })),
      mappedAccounts: mapped,
    });
  } catch (e) {
    return error(String(e), 500);
  }
});
