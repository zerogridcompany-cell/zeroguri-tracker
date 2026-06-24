"use client";

// web/components/ConnectionHub.tsx — SNS アカウント連携ハブ（YouTube / TikTok / Instagram）
// スクレイピングモデル: 全プラットフォーム共通でハンドル連携 + bio-code 本人確認。
// 同一プラットフォームに複数アカウントを連携でき、各アカウントは個別に解除できる。

import { useState } from "react";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ChallengeModal } from "@/components/ChallengeModal";
import { supabase, functionsUrl } from "@/lib/supabase";
import type { AccountStatus, Platform } from "@/lib/types";

const ORDER: Platform[] = ["youtube", "instagram", "tiktok"];

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

// この案件に属する連携アカウントのみ表示・操作する（案件ごとに連携を分離）。
export function ConnectionHub({
  accounts,
  campaignId,
  onChanged,
}: {
  accounts: AccountStatus[];
  campaignId: string | null;
  onChanged?: () => void; // 連携/解除後の再取得（未指定ならフルリロード）
}) {
  const [modalPlatform, setModalPlatform] = useState<Platform | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null); // インライン確認中のアカウント
  const [errId, setErrId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

  // 表示はこの案件の連携だけに絞る
  const scoped = campaignId ? accounts.filter((a) => a.campaignId === campaignId) : [];

  const refresh = onChanged ?? (() => {
    if (typeof window !== "undefined") window.location.reload();
  });

  // window.confirm はブラウザによって抑制される（ダイアログを出さない設定）ため使わない。
  // 1回目クリックで「本当に解除」表示 → 2回目クリックで実行（確実に反応する）。
  async function unlink(id: string) {
    if (!supabase) {
      setErrId(id);
      setErrMsg("ログイン状態を確認できませんでした");
      return;
    }
    setBusyId(id);
    setConfirmId(null);
    setErrId(null);
    setErrMsg("");
    try {
      // 確実に削除するため Edge Function 経由（本人確認のうえ service_role で削除）。
      // クライアント直 DELETE が RLS で無音 0 行になる事故を避ける。
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) {
        setErrId(id);
        setErrMsg("ログインが必要です");
        return;
      }
      const res = await fetch(`${functionsUrl}/unlink-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErrId(id);
        setErrMsg(j?.error ?? `解除に失敗しました（${res.status}）`);
        return;
      }
      refresh();
    } catch {
      setErrId(id);
      setErrMsg("通信に失敗しました。電波状況をご確認ください");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2 className="zg-eyebrow-ja mb-4">アカウント連携</h2>

      <div>
        {ORDER.map((platform, pi) => {
          const linked = scoped.filter(
            (a) => a.platform === platform && a.connectionStatus === "connected" && a.linkedAccountId,
          );
          return (
            <div
              key={platform}
              className={pi < ORDER.length - 1 ? "hairline pb-4 mb-4" : ""}
            >
              {/* プラットフォーム見出し + 連携/追加 */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <PlatformIcon platform={platform} size={24} />
                  <span className="text-sm text-sumi">{PLATFORM_LABEL[platform]}</span>
                  {linked.length === 0 && <span className="text-xs text-faint">未接続</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setModalPlatform(platform)}
                  className="zg-capsule"
                >
                  {linked.length ? "追加" : "連携"}
                </button>
              </div>

              {/* 連携済みアカウント一覧（複数可・個別に解除） */}
              {linked.length > 0 && (
                <div className="mt-3 space-y-2 pl-9">
                  {linked.map((a) => {
                    const id = a.linkedAccountId as string;
                    const busy = busyId === id;
                    const confirming = confirmId === id;
                    return (
                      <div key={id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs text-mid" title={a.handle ?? ""}>
                            {a.handle ?? "—"}
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            {!confirming && <span className="chip text-accent">接続済</span>}
                            {confirming ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void unlink(id)}
                                  disabled={busy}
                                  className="zg-capsule-accent disabled:opacity-50"
                                >
                                  {busy ? "解除中…" : "本当に解除"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmId(null)}
                                  disabled={busy}
                                  className="zg-capsule disabled:opacity-50"
                                >
                                  やめる
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setErrId(null);
                                  setConfirmId(id);
                                }}
                                disabled={busy}
                                className="zg-capsule disabled:opacity-50"
                              >
                                解除
                              </button>
                            )}
                          </div>
                        </div>
                        {confirming && (
                          <p className="pr-1 text-right text-[10px] text-faint">
                            計測動画・集計もすべて削除されます
                          </p>
                        )}
                        {errId === id && errMsg && (
                          <p className="pr-1 text-right text-[11px] text-red-500" role="alert">
                            {errMsg}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ChallengeModal
        platform={modalPlatform ?? "youtube"}
        campaignId={campaignId}
        open={modalPlatform !== null}
        onClose={() => setModalPlatform(null)}
        onLinked={refresh}
      />
    </section>
  );
}
