"use client";

// web/lib/auth.ts — クライアント用 認証ヘルパー（すべて null セーフ / デモ安全）
// hasSupabase=false（supabase=null）のときは何もしない / null を返す。

import { supabase } from "@/lib/supabase";

/** 現在のセッションのアクセストークン。未ログイン / デモ時は null。 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** メールにマジックリンク（OTP）を送信。リンクは /dashboard に戻る。 */
export async function signInWithEmail(email: string): Promise<void> {
  if (!supabase) return;
  const emailRedirectTo =
    typeof window !== "undefined"
      ? window.location.origin + "/dashboard"
      : undefined;
  await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  });
}

/** Google OAuth でサインイン。完了後 /dashboard に戻る。 */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  const redirectTo =
    typeof window !== "undefined"
      ? window.location.origin + "/dashboard"
      : undefined;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

/** サインアウト。 */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** ログイン中ユーザーのメールアドレス（無ければ null）。 */
export async function getUserEmail(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** ログイン中ユーザーがオーガナイザー（案件主催）か。RPC is_organizer() で判定。 */
export async function isOrganizer(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase.rpc("is_organizer");
    return data === true;
  } catch {
    return false;
  }
}

/**
 * 認証状態の変化を購読。cb にはサインイン中かどうかを渡す。
 * 戻り値の関数で購読解除する。
 */
export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(Boolean(session));
  });
  return () => data.subscription.unsubscribe();
}
