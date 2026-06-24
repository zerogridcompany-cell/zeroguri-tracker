// buffer-connect-self — 本人が自分の Buffer アクセストークンでサイト内連携（verify_jwt=true / クリエイター本人）
// トークンを検証 → そのユーザーのチャンネル取得 → 暗号化保存 → 本人の連携アカウントを一意ハンドルで紐付け。
// 以降、本人のトークンで本人のアカウントへ予約投稿する。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { encryptToken } from "../_shared/crypto.ts";

interface Ch { id: string; service: string; name?: string | null; isDisconnected?: boolean }

async function gql(token: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const token = (body.token as string | undefined)?.trim();
    if (!token) return error("Bufferのアクセストークンを入力してください", 400);

    // 1) トークン検証＋ org id 取得（失敗時は Buffer の実エラーを返す＝原因が分かるように）
    const acc = await gql(token, "{ account { id organizations { id name } } }");
    const account = (acc?.data as { account?: { organizations?: { id: string }[] } } | undefined)?.account;
    if (!account) {
      const detail = acc?.errors ? JSON.stringify(acc.errors).slice(0, 220) : "応答に account が含まれていません";
      return error("Bufferトークンを確認してください: " + detail, 400);
    }
    const orgId = account.organizations?.[0]?.id;
    if (!orgId) return error("Bufferの組織が見つかりません", 400);

    // 2) そのユーザーのチャンネル取得
    const chRes = await gql(token, `{ channels(input: { organizationId: "${orgId}" }) { id service name isDisconnected } }`);
    const channels = ((chRes?.data as { channels?: Ch[] } | undefined)?.channels ?? null);
    if (!Array.isArray(channels)) {
      const detail = chRes?.errors ? JSON.stringify(chRes.errors).slice(0, 220) : "";
      return error("Bufferのチャンネル取得に失敗しました " + detail, 502);
    }

    // 3) トークンを暗号化保存（user_buffer_connections）
    const enc = await encryptToken(token);
    await db.from("user_buffer_connections").upsert({
      user_id: user.id, token_enc: enc, org_id: orgId, updated_at: new Date().toISOString(),
    });

    // 4) 本人の連携アカウントを紐付け。本人のBufferなのでチャンネルは全て本人所有。
    //    → ハンドル一致を優先。無ければ「同一SNSのチャンネルが1つだけ」ならそれを採用（表記違いでも本人の口座）。
    const norm = (s: string | null | undefined) => (s ?? "").replace(/^@/, "").trim().toLowerCase();
    const connected = channels.filter((c) => !c.isDisconnected);
    const connectedIds = new Set(connected.map((c) => c.id));
    const { data: accounts } = await db
      .from("linked_accounts").select("id, platform, handle, platform_user_id, buffer_channel_id").eq("user_id", user.id);
    let linked = 0;
    for (const a of accounts ?? []) {
      const cur = (a.buffer_channel_id as string | null) ?? null;
      if (cur && connectedIds.has(cur)) { linked++; continue; }
      const same = connected.filter((c) => c.service === a.platform);
      const byHandle = same.find((c) =>
        norm(c.name) !== "" && (norm(c.name) === norm(a.handle as string) || norm(c.name) === norm(a.platform_user_id as string)));
      const cid = byHandle?.id ?? (same.length === 1 ? same[0].id : null); // 本人所有なので単独なら採用
      if (cid !== cur) await db.from("linked_accounts").update({ buffer_channel_id: cid }).eq("id", a.id);
      if (cid) linked++;
    }

    return json({
      ok: true,
      channelNames: connected.map((c) => c.name).filter(Boolean), // 繋がってる垢（不一致時の手がかり）
      channels: channels.map((c) => ({ service: c.service, name: c.name, isDisconnected: Boolean(c.isDisconnected) })),
      linkedAccounts: linked,
    });
  } catch (e) {
    return error(String(e), 500);
  }
});
