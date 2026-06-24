"use client";

// web/components/DiscordGateModal.tsx — Discord「表示名」必須化の一時ゲート
// 表示名(profiles.discord_display_name)が未入力のユーザーには、アプリを開いた時に
// 閉じられないポップアップを出して必ず入力させる。入力済みになると二度と出ない。
// 未入力判定は親(RoleRouter)が onboarded と同時に取得して渡す（描画のチラつき防止）。
// ※ 今後は登録時に必須化されるため、この一時ゲートはいずれ不要になる。

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export function DiscordGateModal({
  uid,
  initialNeedsGate,
}: {
  uid: string | null;
  initialNeedsGate: boolean;
}) {
  const [needsGate, setNeedsGate] = useState(initialNeedsGate);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  async function save() {
    const name = value.trim();
    if (!name) {
      setError("Discord の表示名を入力してください");
      return;
    }
    if (!supabase || !uid) {
      setError("接続できませんでした。時間をおいて再度お試しください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // update + select で「実際に1行更新された」ことを確認してから閉じる。
      // 行が無い / RLS で弾かれた等で 0 行のときは閉じない（バイパス防止）。
      const { data, error: upErr } = await supabase
        .from("profiles")
        .update({ discord_display_name: name })
        .eq("user_id", uid)
        .select("user_id");
      if (upErr) {
        setError(upErr.message || "保存に失敗しました");
        return;
      }
      if (!data || data.length === 0) {
        setError("保存できませんでした。時間をおいて再度お試しください");
        return;
      }
      setNeedsGate(false); // 入力完了 → ゲート解除
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  // フォーカストラップ: Tab / Shift+Tab がモーダルの外（背後のダッシュボード）へ抜けないようにする。
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !boxRef.current) return;
    const focusables = boxRef.current.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!needsGate) return null;

  // 閉じるボタン無し・オーバーレイクリックでも閉じない（入力するまで必ず残る）。
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Discord 表示名の登録"
      onKeyDown={onKeyDown}
    >
      <div
        ref={boxRef}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-6"
      >
        <h2 className="zg-eyebrow-ja mb-1">Discord の表示名を登録してください</h2>
        <p className="mb-4 text-xs leading-relaxed text-mid">
          報酬のご連絡に Discord を使います。<span className="text-sumi">表示名</span>を入力してください
          （@から始まる<span className="text-sumi">ユーザー名ではありません</span>）。
          下の画像の「Seiyo」のように、プロフィールに大きく表示されている名前です。
        </p>

        <img
          src="/discord-display-name-guide.png"
          alt="Discord の表示名の例（プロフィール下に大きく表示される名前）"
          className="mb-4 w-full max-w-[280px] rounded-xl border border-line"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-mid">
            Discord 表示名<span className="ml-1 text-[var(--accent)]">＊</span>
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="例：Seiyo"
            autoFocus
            className="zg-input"
          />
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-500" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !value.trim()}
          className="zg-capsule-accent mt-5 w-full disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存して続ける"}
        </button>
        <p className="mt-3 text-center text-[10px] text-faint">
          入力するまで閉じられません
        </p>
      </div>
    </div>
  );
}
