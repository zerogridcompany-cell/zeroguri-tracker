"use client";

// web/components/ChallengeModal.tsx — ハンドル連携 + 本人確認（YouTube / TikTok / Instagram）
// 2ステップ: ①確認コードを発行 → ②自分のプロフィール(bio/概要欄)に貼って「確認」。
// link-challenge-verify がプロフィールを取得しコードを照合 → 一致時のみ連携作成。

import { useEffect, useState } from "react";
import { supabase, functionsUrl } from "@/lib/supabase";

type LinkPlatform = "youtube" | "tiktok" | "instagram";

const PLATFORM_LABEL: Record<LinkPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const PLACEHOLDER: Record<LinkPlatform, string> = {
  youtube: "@ハンドル または チャンネルID",
  tiktok: "@ユーザー名",
  instagram: "ユーザー名（@なし）",
};

async function authHeader(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!supabase) return headers;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* demo-safe */
  }
  return headers;
}

export function ChallengeModal({
  platform,
  campaignId,
  open,
  onClose,
  onLinked,
}: {
  platform: LinkPlatform;
  campaignId: string | null;
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [step, setStep] = useState<"input" | "verify">("input");
  const [identifier, setIdentifier] = useState("");
  const [nonce, setNonce] = useState("");
  const [instructions, setInstructions] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("input");
      setIdentifier("");
      setNonce("");
      setInstructions("");
      setCopied(false);
      setMessage("");
      setBusy(false);
    }
  }, [open, platform]);

  if (!open) return null;

  // ① 確認コードを発行
  async function issueCode() {
    const id = identifier.trim();
    if (!id) {
      setMessage("アカウント名（@handle）を入力してください");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const headers = await authHeader();
      if (!headers.Authorization) {
        setMessage("先にログインしてください");
        return;
      }
      const res = await fetch(`${functionsUrl}/link-challenge-create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ platform, identifier: id }),
      });
      const json = (await res.json()) as { nonce?: string; instructions?: string; error?: string };
      if (res.ok && json?.nonce) {
        setNonce(json.nonce);
        setInstructions(json.instructions ?? "");
        setStep("verify");
      } else {
        setMessage(json?.error ?? "コードの発行に失敗しました");
      }
    } catch {
      setMessage("コードの発行に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // ② プロフィールのコードを照合して連携
  async function verify() {
    if (!campaignId) {
      setMessage("案件を選択してください");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const headers = await authHeader();
      if (!headers.Authorization) {
        setMessage("先にログインしてください");
        return;
      }
      const res = await fetch(`${functionsUrl}/link-challenge-verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ platform, identifier: identifier.trim(), campaign_id: campaignId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json?.ok) {
        onLinked();
        onClose();
      } else {
        setMessage(json?.error ?? "確認に失敗しました");
      }
    } catch {
      setMessage("確認に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(nonce);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 非対応でも手動コピー可 */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-line bg-white p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`${PLATFORM_LABEL[platform]} 連携`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center text-faint transition-colors hover:text-sumi"
        >
          ×
        </button>

        <h2 className="zg-eyebrow-ja mb-1">{PLATFORM_LABEL[platform]} を連携</h2>

        {step === "input" ? (
          <>
            <p className="mb-6 text-xs text-mid">
              本人確認のため、あなたの {PLATFORM_LABEL[platform]} アカウント名を入力してください
            </p>
            <div className="flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="zg-eyebrow-ja">アカウント名</span>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void issueCode();
                  }}
                  placeholder={PLACEHOLDER[platform]}
                  autoFocus
                  className="zg-input"
                />
              </label>

              {message && (
                <p className="text-xs text-red-500" role="alert">
                  {message}
                </p>
              )}

              <button
                type="button"
                onClick={issueCode}
                disabled={busy}
                className="zg-capsule-accent disabled:opacity-50"
              >
                {busy ? "発行中…" : "確認コードを発行"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-mid">
              下のコードを <span className="text-sumi">{identifier}</span> のプロフィール（bio / 概要欄）に貼り付けて保存し、「確認する」を押してください。
            </p>

            {/* 確認コード */}
            <button
              type="button"
              onClick={copyCode}
              className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-bg px-4 py-3 text-left transition-colors hover:border-accent"
              title="クリックでコピー"
            >
              <span className="break-all font-display text-sm text-sumi">{nonce}</span>
              <span className="shrink-0 text-[11px] text-faint">{copied ? "コピー済" : "コピー"}</span>
            </button>

            {instructions && <p className="mb-5 text-[11px] leading-relaxed text-faint">{instructions}</p>}

            {message && (
              <p className="mb-4 text-xs text-red-500" role="alert">
                {message}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("input");
                  setMessage("");
                }}
                disabled={busy}
                className="zg-capsule disabled:opacity-50"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={verify}
                disabled={busy}
                className="zg-capsule-accent disabled:opacity-50"
              >
                {busy ? "確認中…" : "確認する"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
