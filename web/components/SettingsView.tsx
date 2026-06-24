"use client";

// web/components/SettingsView.tsx — 設定（ダッシュボードにタブとして埋め込み）
// プロフィール編集（OnboardingForm を再利用）＋ アカウント削除（danger zone）。
// 自己完結のコンテンツのみ（ページヘッダー / サインアウトは <main> 側が持つ）。

import { useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken, signOut } from "@/lib/auth";
import { OnboardingForm } from "@/components/OnboardingForm";

export function SettingsView({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setError("");
    if (!window.confirm("本当にアカウントを削除しますか？元に戻せません。")) return;

    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/delete-account`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError("削除に失敗しました。時間をおいて再度お試しください");
        setBusy(false);
        return;
      }
      await signOut();
      onAccountDeleted();
    } catch {
      setError("削除に失敗しました。時間をおいて再度お試しください");
      setBusy(false);
    }
  }

  return (
    <div>
      {/* ヘッダー */}
      <header className="mb-8">
        <p className="zg-eyebrow-ja mb-1">設定</p>
        <p className="text-sm text-mid">プロフィールの変更・アカウント削除</p>
      </header>

      {/* プロフィール編集（既存フォームを再利用してプリフィル＆upsert） */}
      <OnboardingForm onDone={() => { /* saved */ }} />

      {/* DANGER ZONE */}
      <section className="mt-12 pt-10" style={{ borderTop: "0.5px solid var(--line)" }}>
        <h2 className="zg-eyebrow-ja mb-2">アカウント削除</h2>
        <p className="mb-5 text-xs text-faint">
          アカウントと全データ（連携・動画・報酬）が完全に削除されます
        </p>
        {error && (
          <p className="mb-4 text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={deleteAccount}
          disabled={busy}
          className="zg-capsule border-[#A8443A] text-[#A8443A] hover:border-[#A8443A] disabled:opacity-50"
        >
          {busy ? "削除中…" : "アカウントを削除"}
        </button>
      </section>
    </div>
  );
}
