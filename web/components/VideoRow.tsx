"use client";

// web/components/VideoRow.tsx — キャンペーン内の 1 動画行
// 計測中は完了率%（進捗バー）と「次回計測までのカウントダウン」を表示。
// ステータスは状態に応じて1つだけ。名前は鉛筆→インライン編集（Enter / フォーカス外で保存）。

import { useRef, useState } from "react";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ProgressBar } from "@/components/ProgressBar";
import { GrowthSparkline } from "@/components/GrowthSparkline";
import { formatYen, formatCountdown } from "@/lib/format";
import type { VideoRow as VideoRowData } from "@/lib/types";

/** 編集用の小さな鉛筆アイコン */
export function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function VideoRow({
  video,
  onDelete,
  onRename,
  now,
}: {
  video: VideoRowData;
  onDelete?: (trackedVideoId: string) => void;
  onRename?: (trackedVideoId: string, newTitle: string | null) => void;
  now?: number;
}) {
  const t = now ?? Date.now();
  const isDone = video.displayStatus === "retired" || video.displayStatus === "completed";
  const isReview = video.displayStatus === "review";
  const awaitingFirst = !isDone && !video.lastCheckedAt; // 追加直後・まだ一度も計測していない
  const due = !isDone && video.nextCheckAt ? new Date(video.nextCheckAt).getTime() - t <= 0 : false;

  // インライン名前編集
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const skipRef = useRef(false);
  function startEdit() {
    setDraft(video.title ?? "");
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const next = draft.trim() || null;
    if (next !== (video.title ?? null)) onRename?.(video.trackedVideoId, next);
  }

  // 状態に応じてステータスを1つだけ表示
  let statusText: string;
  let statusCls: string;
  if (isDone) {
    statusText = "計測完了";
    statusCls = "text-status-completed";
  } else if (isReview) {
    statusText = "要確認";
    statusCls = "text-status-review";
  } else if (awaitingFirst) {
    statusText = "初回計測中…";
    statusCls = "text-accent";
  } else if (due) {
    statusText = "計測中…";
    statusCls = "text-accent";
  } else {
    statusText = `次回 ${formatCountdown(video.nextCheckAt, t)}`;
    statusCls = "text-faint";
  }

  return (
    <div className="flex items-center gap-4 py-3">
      {/* 左: プラットフォーム + タイトル(動画リンク/編集) + アカウント/ID */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <PlatformIcon platform={video.platform} size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") {
                    skipRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={commit}
                className="zg-input min-w-0 flex-1 py-0.5 text-sm"
                placeholder="動画名"
              />
            ) : (
              <>
                {video.url ? (
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-sans text-sm text-sumi underline decoration-line underline-offset-2 hover:text-accent"
                    title="動画を開く"
                  >
                    {video.title ?? "（無題）"}
                  </a>
                ) : (
                  <span className="truncate font-sans text-sm text-sumi">
                    {video.title ?? "（無題）"}
                  </span>
                )}
                {onRename ? (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="shrink-0 text-faint transition-colors hover:text-sumi"
                    aria-label="名前を編集"
                    title="名前を編集"
                  >
                    <PencilIcon />
                  </button>
                ) : null}
              </>
            )}
          </div>
          <div className="truncate font-display text-[10px] text-faint">
            {video.handle ? <span className="text-mid">{video.handle}</span> : null}
            {video.handle ? " · " : ""}
            {video.contentId}
          </div>
        </div>
      </div>

      {/* 中央: 進捗バー（完了率%）+ 推移スパークライン */}
      <div className="flex w-44 shrink-0 items-center gap-3">
        <ProgressBar views={video.attributableViews} cap={video.cap} />
        {video.trend ? (
          <span className="text-faint">
            <GrowthSparkline points={video.trend} />
          </span>
        ) : null}
      </div>

      {/* 右: 確定額 + ステータス（1つだけ） */}
      <div className="flex w-28 shrink-0 flex-col items-end gap-1 text-right">
        <span className="font-display text-base font-semibold tabular-nums text-sumi">
          {formatYen(video.billableAmount)}
        </span>
        <span className={"font-display text-[11px] " + statusCls}>{statusText}</span>
      </div>

      {/* 削除 */}
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(video.trackedVideoId)}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-faint hover:text-[#A8443A]"
          aria-label="削除"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
