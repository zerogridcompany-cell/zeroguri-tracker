"use client";

// web/components/AddVideoModal.tsx — トラッキング対象の動画を登録（承認なしの直接追加）
// register-tracked-video Edge Function を呼び出す（要ログイン）。

import { useEffect, useMemo, useState } from "react";
import type { AccountStatus, CampaignSummary } from "@/lib/types";
import { functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";

export function AddVideoModal({
  open,
  onClose,
  onAdded,
  campaigns,
  accounts,
  defaultCampaignId,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  campaigns: CampaignSummary[];
  accounts: AccountStatus[];
  defaultCampaignId?: string;
}) {
  const [campaignId, setCampaignId] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [contentId, setContentId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinable, setJoinable] = useState<{ campaignId: string; title: string }[]>([]);

  // 連携アカウントは「選択中の案件」のものだけ（案件ごとに連携が分離されているため）
  const connectedAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.connectionStatus === "connected" && a.linkedAccountId && a.campaignId === campaignId,
      ),
    [accounts, campaignId],
  );

  const campaignOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns) map.set(c.campaignId, c.title);
    for (const c of joinable) if (!map.has(c.campaignId)) map.set(c.campaignId, c.title);
    return [...map.entries()].map(([campaignId, title]) => ({ campaignId, title }));
  }, [campaigns, joinable]);

  useEffect(() => {
    if (open) {
      setContentId("");
      setTitle("");
      setMessage("");
      setBusy(false);
      void (async () => {
        if (!supabase) {
          setCampaignId(defaultCampaignId ?? campaigns[0]?.campaignId ?? "");
          return;
        }
        const { data } = await supabase.from("campaigns").select("id, title").eq("status", "active");
        const list = (data ?? []).map((c) => ({ campaignId: c.id as string, title: c.title as string }));
        setJoinable(list);
        setCampaignId(defaultCampaignId ?? campaigns[0]?.campaignId ?? list[0]?.campaignId ?? "");
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultCampaignId]);

  useEffect(() => {
    setLinkedAccountId(connectedAccounts[0]?.linkedAccountId ?? "");
  }, [connectedAccounts]);

  if (!open) return null;

  const noPrereq = campaignOptions.length === 0 || connectedAccounts.length === 0;

  async function submit() {
    const content = contentId.trim();
    if (!campaignId || !linkedAccountId) {
      setMessage("先に案件と連携アカウントが必要です");
      return;
    }
    if (!content) {
      setMessage("動画ID または URL を入力してください");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage("ログインが必要です");
        return;
      }
      const res = await fetch(`${functionsUrl}/register-tracked-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          campaign_id: campaignId,
          linked_account_id: linkedAccountId,
          content_id: content,
          title: title.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        onAdded();
        onClose();
      } else {
        setMessage(json?.error ?? "動画の登録に失敗しました");
      }
    } catch {
      setMessage("動画の登録に失敗しました");
    } finally {
      setBusy(false);
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
        aria-label="動画を追加"
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

        <h2 className="zg-eyebrow-ja mb-1">動画を追加</h2>
        <p className="mb-6 text-xs text-mid">トラッキング対象の動画を登録します</p>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">案件</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="zg-input">
              {campaignOptions.length === 0 && <option value="">案件がありません</option>}
              {campaignOptions.map((c) => (
                <option key={c.campaignId} value={c.campaignId}>{c.title}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">連携アカウント</span>
            <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)} className="zg-input">
              {connectedAccounts.length === 0 && <option value="">連携アカウントがありません</option>}
              {connectedAccounts.map((a) => (
                <option key={a.linkedAccountId} value={a.linkedAccountId ?? ""}>
                  {a.platform} {a.handle ?? ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">動画ID または URL</span>
            <input
              type="text"
              value={contentId}
              onChange={(e) => setContentId(e.target.value)}
              placeholder="例：https://youtu.be/xxxx または 動画ID"
              required
              className="zg-input"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">動画タイトル（任意）</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="動画のタイトル"
              className="zg-input"
            />
          </label>

          {noPrereq && <p className="text-xs text-mid">先に案件と連携アカウントが必要です</p>}
          {message && <p className="text-xs text-red-500" role="alert">{message}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={busy || noPrereq}
            className="zg-capsule-accent disabled:opacity-50"
          >
            {busy ? "登録中…" : "動画を追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
