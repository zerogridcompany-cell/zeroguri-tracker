"use client";

// web/components/BufferCompose.tsx — Buffer 連携の予約投稿（オーガナイザー）。
// Instagram(heymeisa.shape)へ createPost。メディアは公開URLを Buffer が取得。
// ※ automatic(直接公開)は IG 接続が健全である必要あり。要更新時は notification を使う。

import { useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";

export function BufferCompose() {
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [igType, setIgType] = useState<"post" | "reel" | "story">("post");
  const [dueAt, setDueAt] = useState(""); // datetime-local
  const [schedulingType, setSchedulingType] = useState<"notification" | "automatic">("notification");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  async function submit(saveToDraft: boolean) {
    if (!mediaUrl.trim()) {
      setMsg("メディアURL（公開アクセス可）が必要です");
      return;
    }
    setBusy(true);
    setMsg("");
    setDone(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/buffer-post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          mediaUrl: mediaUrl.trim(),
          mediaType,
          igType,
          schedulingType,
          saveToDraft,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMsg(j.error ?? "投稿に失敗しました");
        return;
      }
      setDone(true);
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="zg-eyebrow-ja">予約投稿（Buffer）</span>
        <p className="mt-1 text-xs leading-relaxed text-mid">
          Instagram <span className="text-sumi">heymeisa.shape</span> へ予約投稿します。
          メディアは公開URL（Buffer が取得）が必要です。
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="zg-eyebrow-ja">本文 / キャプション</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="キャプション…"
          className="zg-input resize-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="zg-eyebrow-ja">メディア種別</span>
          <select value={mediaType} onChange={(e) => setMediaType(e.target.value as "image" | "video")} className="zg-input">
            <option value="image">画像</option>
            <option value="video">動画</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="zg-eyebrow-ja">投稿タイプ</span>
          <select value={igType} onChange={(e) => setIgType(e.target.value as "post" | "reel" | "story")} className="zg-input">
            <option value="post">フィード投稿</option>
            <option value="reel">リール</option>
            <option value="story">ストーリー</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="zg-eyebrow-ja">メディアURL（公開）</span>
        <input
          type="url"
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="https://…/media.jpg または .mp4"
          className="zg-input"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="zg-eyebrow-ja">予約日時</span>
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="zg-input" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="zg-eyebrow-ja">公開方法</span>
          <select
            value={schedulingType}
            onChange={(e) => setSchedulingType(e.target.value as "notification" | "automatic")}
            className="zg-input"
          >
            <option value="notification">通知（手動で投稿）</option>
            <option value="automatic">自動公開</option>
          </select>
        </label>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        ※「自動公開」は Buffer 側で Instagram 接続が有効である必要があります。現在「要更新（Requires
        refreshing）」の場合は、先に publish.buffer.com で接続を更新してください。それまでは「通知」をご利用ください。
      </p>

      {msg && <p className="text-xs text-red-500" role="alert">{msg}</p>}
      {done && <p className="text-sm text-sumi">✅ Buffer に登録しました。</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => submit(false)} disabled={busy} className="zg-capsule-accent disabled:opacity-50">
          {busy ? "送信中…" : "予約する"}
        </button>
        <button type="button" onClick={() => submit(true)} disabled={busy} className="zg-capsule disabled:opacity-50">
          下書き保存
        </button>
      </div>
    </section>
  );
}
