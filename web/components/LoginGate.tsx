"use client";

// web/components/LoginGate.tsx — 認証ゲート
// hasSupabase=false（anon key 未設定）なら DEMO モードとして素通し。
// それ以外はセッションを確認し、未ログインならログインカードを表示。

import { useEffect, useState } from "react";
import { hasSupabase, supabase } from "@/lib/supabase";
import { onAuthChange, signInWithEmail, signInWithGoogle } from "@/lib/auth";

type SessionState = "loading" | "none" | "active";

export function LoginGate({ children }: { children: React.ReactNode }) {
  // DEMO モード: 認証なしでそのまま表示
  if (!hasSupabase) return <>{children}</>;
  return <AuthGate>{children}</AuthGate>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>("loading");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    // セッション確認が遅延/ロック待ちでも無限ローディングにしない保険（1.5秒で未ログイン扱い）
    const fallback = setTimeout(() => {
      if (active) setState((s) => (s === "loading" ? "none" : s));
    }, 1500);
    (async () => {
      if (!supabase) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (active) setState(data?.session ? "active" : "none");
      } catch {
        if (active) setState("none");
      }
    })();
    const unsub = onAuthChange((signedIn) => {
      setState(signedIn ? "active" : "none");
    });
    return () => {
      active = false;
      clearTimeout(fallback);
      unsub();
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-faint">
        読み込み中…
      </div>
    );
  }

  if (state === "active") return <>{children}</>;

  async function handleSendLink() {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      await signInWithEmail(value);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <span className="zg-eyebrow">ZEROGURI</span>
        <h1 className="zg-hero mt-1 text-[40px]">TRACKER</h1>
        <p className="mt-2 text-[11px] text-faint">
          再生数トラッキング
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="zg-input"
          />
          <button
            type="button"
            onClick={handleSendLink}
            disabled={busy}
            className="zg-capsule-accent disabled:opacity-50"
          >
            {busy ? "送信中…" : "ログインリンクを送る"}
          </button>
          {sent && (
            <p className="text-[11px] text-accent" role="status">
              メールのリンクから入ってください
            </p>
          )}

          <div className="my-1 flex items-center gap-3 text-[10px] text-faint">
            <span className="h-px flex-1 bg-line" />
            または
            <span className="h-px flex-1 bg-line" />
          </div>

          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="zg-capsule"
          >
            Google で続行
          </button>
        </div>
      </div>
    </main>
  );
}
