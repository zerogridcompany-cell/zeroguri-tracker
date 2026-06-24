"use client";

// web/components/RejectionPopup.tsx — 却下の確実な通知ポップアップ（クリエイター）
// 自分の提出が却下され未読(seen_by_user=false)のものがあれば、必ず最前面に表示。
// 「修正して再提出」→ 提出フォームに内容をプリフィルして遷移。「確認」→ 既読化して閉じる。
// ダッシュボード内に常設し、ポーリングで取りこぼしなく検知する。

import { useCallback, useEffect, useRef, useState } from "react";
import { functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { PlatformIcon } from "@/components/PlatformIcon";
import type { SubmitPrefill } from "@/components/VideoSubmit";

type IgType = "post" | "reel" | "story";
type Platform = "youtube" | "tiktok" | "instagram";

interface RejectedSub {
  id: string;
  public_url: string;
  media_type: "video" | "image";
  submission_type: "auto" | "manual";
  url: string | null;
  ig_type: IgType | null;
  caption: string | null;
  hashtags: string | null;
  scheduled_at: string | null;
  reject_reason: string | null;
  platform: Platform | null;
  handle: string | null;
  linked_account_id: string | null;
  created_at: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RejectionPopup({ onResubmit }: { onResubmit: (p: SubmitPrefill) => void }) {
  const [queue, setQueue] = useState<RejectedSub[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const resubmitRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return;
    const { data } = await supabase
      .from("video_submissions")
      .select("id, public_url, media_type, submission_type, url, ig_type, caption, hashtags, scheduled_at, reject_reason, platform, handle, linked_account_id, created_at")
      .eq("user_id", uid)
      .eq("status", "rejected")
      .eq("seen_by_user", false)
      .order("reviewed_at", { ascending: false });
    setQueue((data ?? []) as RejectedSub[]);
  }, []);

  useEffect(() => {
    void refresh();
    // 取りこぼし防止のためポーリング（承認画面からの却下を確実に拾う）
    const id = setInterval(() => void refresh(), 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const current = queue[0] ?? null;
  const currentId = current?.id ?? null;

  // モーダルを開いた/次へ進んだら主アクションへフォーカス
  useEffect(() => {
    if (currentId) {
      setError(null);
      resubmitRef.current?.focus();
    }
  }, [currentId]);

  // フォーカストラップ: Tab / Shift+Tab が背後のダッシュボードへ抜けないように
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !boxRef.current) return;
    const f = boxRef.current.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // サーバ側（service_role）で確実に既読化。RLS に依存しない。
  async function ack(id: string): Promise<boolean> {
    const token = await getAccessToken();
    const res = await fetch(`${functionsUrl}/submission-ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(res.ok && j.ok);
  }

  async function handleConfirm() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      // 既読化が成功したときだけ閉じる（失敗時は閉じない＝次のポーリングで再表示し取りこぼさない）
      if (!(await ack(current.id))) {
        setError("通信に失敗しました。もう一度お試しください。");
        return;
      }
      setQueue((q) => q.filter((s) => s.id !== current.id));
    } finally {
      setBusy(false);
    }
  }

  async function handleResubmit() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await ack(current.id))) {
        setError("通信に失敗しました。もう一度お試しください。");
        return;
      }
      setQueue((q) => q.filter((s) => s.id !== current.id));
      onResubmit({
        fromId: current.id,
        caption: current.caption ?? "",
        igType: current.ig_type ?? "reel",
        scheduledAt: toLocalInput(current.scheduled_at),
        linkedAccountId: current.linked_account_id,
        submissionType: current.submission_type ?? "auto",
        url: current.url ?? current.public_url ?? null,
        hashtags: current.hashtags ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="提出が却下されました"
      onKeyDown={onKeyDown}
    >
      <div
        ref={boxRef}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#A8443A]/12 text-base text-[#A8443A]">
            !
          </span>
          <h2 className="text-base text-sumi">提出が却下されました</h2>
        </div>

        <div className="mb-3 flex items-center gap-2 text-[11px] text-faint">
          {current.platform && <PlatformIcon platform={current.platform} size={14} />}
          <span className="truncate">
            {current.handle ?? (current.platform ? PLATFORM_LABEL[current.platform] : "")}
          </span>
        </div>

        {/* 却下理由 */}
        <div className="mb-4 rounded-xl border border-[#A8443A]/25 bg-[#A8443A]/5 p-3">
          <div className="zg-eyebrow-ja mb-1 text-[#A8443A]">却下理由</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-sumi">
            {current.reject_reason?.trim() || "理由は記載されていません。内容を見直して再提出してください。"}
          </p>
        </div>

        {/* プレビュー（提出したアップロード動画/画像）。重い動画対策で preload="none"。 */}
        <div className="mb-1 overflow-hidden rounded-lg border border-line bg-black/5">
          {current.media_type === "video" ? (
            <video src={current.public_url} controls preload="none" playsInline className="max-h-56 w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.public_url} alt="" className="max-h-56 w-full object-contain" />
          )}
        </div>
        {current.media_type === "video" && (
          <a href={current.public_url} target="_blank" rel="noopener noreferrer" className="mb-4 inline-block text-[11px] text-accent">
            再生されない場合は別タブで開く ↗
          </a>
        )}

        {current.caption && (
          <p className="mb-4 line-clamp-3 text-[11px] text-mid">{current.caption}</p>
        )}

        {error && <p className="mb-2 text-xs text-red-500" role="alert">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            ref={resubmitRef}
            type="button"
            onClick={handleResubmit}
            disabled={busy}
            className="zg-capsule-accent flex-1 disabled:opacity-50"
          >
            修正して再提出
          </button>
          <button type="button" onClick={handleConfirm} disabled={busy} className="zg-capsule disabled:opacity-50">
            確認
          </button>
        </div>
        {queue.length > 1 && (
          <p className="mt-3 text-center text-[10px] text-faint">
            他に {queue.length - 1} 件の却下があります
          </p>
        )}
      </div>
    </div>
  );
}
