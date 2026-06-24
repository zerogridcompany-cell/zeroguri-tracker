// _shared/discord.ts — Discord Bot でチャンネルに通知/リプライ。
// secret: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID。
const API = "https://discord.com/api/v10";

function cfg() {
  return { token: Deno.env.get("DISCORD_BOT_TOKEN"), channel: Deno.env.get("DISCORD_CHANNEL_ID") };
}

/** チャンネルにメッセージ投稿。返り値は message id（リプライ用に保存）。失敗時 null。 */
export async function discordPost(content: string): Promise<string | null> {
  const { token, channel } = cfg();
  if (!token || !channel) return null;
  try {
    const res = await fetch(`${API}/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    return j?.id ?? null;
  } catch {
    return null;
  }
}

/** 既存メッセージにリプライ。message_id が無い/失敗時は通常投稿にフォールバック。 */
export async function discordReply(messageId: string | null, content: string): Promise<void> {
  const { token, channel } = cfg();
  if (!token || !channel) return;
  try {
    await fetch(`${API}/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
        ...(messageId ? { message_reference: { message_id: messageId, fail_if_not_exists: false } } : {}),
      }),
    });
  } catch {
    /* ignore */
  }
}
