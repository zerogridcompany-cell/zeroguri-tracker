// _shared/supabase.ts — service_role 管理クライアント + トークン/監査ヘルパー
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { config } from "./env.ts";
import { decryptToken, encryptToken } from "./crypto.ts";
import type { Platform, Token } from "./providers/types.ts";

let _admin: SupabaseClient | null = null;

/** RLS をバイパスする service_role クライアント（Edge Functions 専用） */
export function admin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(config.supabaseUrl(), config.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/** Authorization ヘッダの JWT からユーザーを解決（verify_jwt=true の関数用） */
// email は検証済み JWT 由来（不変）。認可はこの email を根拠にする（可変な app_users.email は信用しない）。
export async function getUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** LIKE メタ文字をエスケープし、ilike を「大文字小文字を無視した完全一致」にする。 */
export function likeExact(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export interface LinkedAccountRow {
  id: string;
  user_id: string;
  platform: Platform;
  platform_user_id: string;
  handle: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
}

/** 監査ログ（IPO 対応）。トークン復号/参照のたびに記録。 */
export async function audit(
  linkedAccountId: string | null,
  accessor: string,
  action: "decrypt" | "refresh" | "revoke" | "read",
  context?: Record<string, unknown>,
): Promise<void> {
  await admin().from("token_access_audit").insert({
    linked_account_id: linkedAccountId,
    accessor,
    action,
    context: context ?? null,
  });
}

/** linked_accounts 行 → 復号済み Token。監査ログを残す。 */
export async function decryptAccountToken(
  row: LinkedAccountRow,
  accessor: string,
): Promise<Token> {
  await audit(row.id, accessor, "decrypt");
  return {
    accessToken: (await decryptToken(row.access_token_enc)) ?? "",
    refreshToken: (await decryptToken(row.refresh_token_enc)) ?? undefined,
    expiresAt: row.token_expires_at ?? undefined,
  };
}

/** Token を暗号化して linked_accounts に保存。 */
export async function persistAccountToken(
  linkedAccountId: string,
  token: Token,
): Promise<void> {
  await admin()
    .from("linked_accounts")
    .update({
      access_token_enc: await encryptToken(token.accessToken),
      refresh_token_enc: await encryptToken(token.refreshToken),
      token_expires_at: token.expiresAt ?? null,
      status: "connected",
      last_error: null,
    })
    .eq("id", linkedAccountId);
}
