"use client";

// web/components/NoticeModal.tsx — 注意/説明のポップアップ（毎回表示、チェックを外すまで）。
// 「今後も表示する」チェックを外して閉じると localStorage に記録し、以後出さない。
// マウント時に表示するので、タブ/モードを切り替えて再マウントするたびに（オプトアウトしない限り）出る。

import { useEffect, useState, type ReactNode } from "react";

export function NoticeModal({
  storageKey,
  title,
  body,
  variant = "warn",
}: {
  storageKey: string;
  title: string;
  body: ReactNode;
  variant?: "warn" | "info";
}) {
  const LS = `zg.notice.${storageKey}.optout`;
  const [show, setShow] = useState(false); // SSR不一致回避: マウント後に判定
  const [keep, setKeep] = useState(true); // 今後も表示する

  useEffect(() => {
    try {
      if (window.localStorage.getItem(LS) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, [LS]);

  if (!show) return null;

  function close() {
    if (!keep) {
      try {
        window.localStorage.setItem(LS, "1");
      } catch {
        /* ignore */
      }
    }
    setShow(false);
  }

  const warn = variant === "warn";
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6">
        <div className="mb-2 flex items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
            style={{
              background: warn ? "rgba(168,68,58,0.12)" : "rgba(0,0,0,0.06)",
              color: warn ? "#A8443A" : "var(--accent)",
            }}
          >
            {warn ? "!" : "i"}
          </span>
          <h2 className="text-base leading-snug text-sumi">{title}</h2>
        </div>
        <div className="text-sm leading-relaxed text-mid">{body}</div>
        <label className="mt-4 flex items-center gap-2 text-[11px] text-mid">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          今後も表示する
        </label>
        <button type="button" onClick={close} className="zg-capsule-accent mt-3 w-full">
          わかりました
        </button>
      </div>
    </div>
  );
}
