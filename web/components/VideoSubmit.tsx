"use client";

// web/components/VideoSubmit.tsx — 動画提出（承認待ち）。
// 動画を Supabase Storage(公開) にアップ → video_submissions に提出（pending）。
// 投稿先アカウント（連携している YouTube / Instagram / TikTok から選択）と
// 希望投稿日時を指定できる。主催者が承認すると Buffer に予約投稿される。

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PlatformIcon } from "@/components/PlatformIcon";

type IgType = "post" | "reel" | "story";
type Platform = "youtube" | "tiktok" | "instagram";

interface LinkedAccount {
  id: string;
  platform: Platform;
  handle: string | null;
  campaign_id: string | null;
}

export interface SubmitPrefill {
  fromId: string;
  caption: string;
  igType: IgType;
  scheduledAt: string; // datetime-local 形式
  linkedAccountId: string | null;
  submissionType?: "auto" | "manual"; // 手動却下の再提出は手動フォームへ
  url?: string | null; // 手動: 投稿URL（再提出時にプリフィル）
  hashtags?: string | null; // 自動: ハッシュタグ（再提出時にプリフィル）
}

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export function VideoSubmit({
  prefill,
  onSubmitted,
  manual = false,
}: {
  prefill?: SubmitPrefill | null;
  onSubmitted?: () => void;
  manual?: boolean; // 手動（投稿前承認）: Buffer/予約なし。承認後にクリエイターが投稿してURL登録。
} = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  // 複数プラットフォーム選択: 投稿先アカウントを複数選べる
  const [accountIds, setAccountIds] = useState<string[]>(prefill?.linkedAccountId ? [prefill.linkedAccountId] : []);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState(prefill?.caption ?? "");
  const [hashtags, setHashtags] = useState(prefill?.hashtags ?? "");
  const [igType, setIgType] = useState<IgType>(prefill?.igType ?? "reel");
  const [scheduledAt, setScheduledAt] = useState(prefill?.scheduledAt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const isVideo = (f: File) => f.type.startsWith("video/");

  // 連携しているアカウントを取得（投稿先の選択肢）
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("linked_accounts")
        .select("id, platform, handle, campaign_id")
        .eq("user_id", uid)
        .eq("status", "connected")
        .order("connected_at", { ascending: true });
      if (!active) return;
      // platform×handle で重複排除（同じアカウントが複数案件に連携されていても1つに）
      const seen = new Set<string>();
      const uniq: LinkedAccount[] = [];
      for (const a of (data ?? []) as LinkedAccount[]) {
        const key = `${a.platform}:${a.handle ?? a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(a);
      }
      setAccounts(uniq);
      // 存在しない選択を除外。何も選択が残らなければ先頭を既定選択。
      setAccountIds((cur) => {
        const valid = cur.filter((id) => uniq.some((a) => a.id === id));
        return valid.length ? valid : (uniq[0] ? [uniq[0].id] : []);
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  // 却下からの再提出: 既にマウント済みでも新しいプリフィルを反映（key を使わず成功表示を保持）
  useEffect(() => {
    if (!prefill) return;
    setAccountIds(prefill.linkedAccountId ? [prefill.linkedAccountId] : []);
    setCaption(prefill.caption);
    setHashtags(prefill.hashtags ?? "");
    setIgType(prefill.igType);
    setScheduledAt(prefill.scheduledAt);
    setDone(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.fromId]);

  const selectedAccounts = useMemo(() => accounts.filter((a) => accountIds.includes(a.id)), [accounts, accountIds]);
  const anyIg = selectedAccounts.some((a) => a.platform === "instagram");
  const toggleAccount = (id: string) =>
    setAccountIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  // datetime-local の下限（現在以降のみ選択可）
  const minDt = useMemo(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), []);

  async function submit() {
    if (!supabase) {
      setError("ログインが必要です");
      return;
    }
    if (selectedAccounts.length === 0) {
      setError("投稿先のアカウントを選択してください");
      return;
    }
    if (!file) {
      setError("動画 / 画像を選択してください");
      return;
    }
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) {
        setError("ログインが必要です");
        return;
      }
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uid}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from("submissions").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) {
        setError("アップロードに失敗しました：" + up.error.message);
        return;
      }
      const publicUrl = supabase.storage.from("submissions").getPublicUrl(path).data.publicUrl;
      // 複数プラットフォームは1回の提出としてまとめる（group_id）。1アップロードを全提出で共有。
      const groupId = selectedAccounts.length > 1 ? crypto.randomUUID() : null;
      const mediaType = isVideo(file) ? "video" : "image";
      const rows = selectedAccounts.map((a) => ({
        user_id: uid,
        submission_type: manual ? "manual" : "auto",
        campaign_id: manual ? a.campaign_id : null,
        group_id: groupId,
        linked_account_id: a.id,
        platform: a.platform,
        handle: a.handle,
        storage_path: path,
        public_url: publicUrl,
        filename: file.name,
        media_type: mediaType,
        ig_type: a.platform === "instagram" ? igType : null,
        caption: caption.trim() || null,
        hashtags: !manual ? (hashtags.trim() || null) : null, // ハッシュタグは自動(Buffer投稿)のみ
        // 手動は承認後に自分で投稿するので予約日時は持たせない
        scheduled_at: !manual && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }));
      const { error: insErr } = await supabase.from("video_submissions").insert(rows);
      if (insErr) {
        setError("提出の登録に失敗しました：" + insErr.message);
        return;
      }
      // 提出直後の Discord 通知 / 自動承認は DB トリガ（trg_video_submissions_process）が
      // サーバー側で確実に・即時（~1-2秒）に処理する。クライアントからは呼ばない（二重発火/レース防止）。
      // （却下の既読化は RejectionPopup 側で submission-ack 経由済み。ここでの client 更新は RLS で no-op のため行わない）
      setDone(true);
      setFile(null);
      setCaption("");
      setHashtags("");
      setScheduledAt("");
      if (inputRef.current) inputRef.current.value = "";
      onSubmitted?.();
    } catch {
      setError("提出に失敗しました。時間をおいて再度お試しください");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="zg-eyebrow-ja">{prefill ? "修正して再提出" : manual ? "投稿前に承認をもらう" : "動画を提出"}</span>
        <p className="mt-1 text-xs leading-relaxed text-mid">
          {manual ? (
            <>
              これから投稿する<span className="text-sumi">動画とキャプション</span>を提出して、主催者の承認をもらいます。
              承認されたら自分のSNSに投稿し、<span className="text-sumi">投稿後にURLを登録</span>すると計測が始まります。
            </>
          ) : (
            <>投稿先のアカウント（複数選択可）と希望日時を選んで提出すると、主催者が確認します。承認されると、選んだ全プラットフォームに Buffer 経由で投稿されます。</>
          )}
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg p-4 text-sm text-mid">
          投稿に使えるアカウントがありません。先にダッシュボードで YouTube / Instagram / TikTok を連携してください。
        </div>
      ) : (
        <>
          {/* 投稿先アカウント（複数選択OK） */}
          <div className="flex flex-col gap-2">
            <span className="zg-eyebrow-ja">投稿先アカウント（複数選択OK）</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {accounts.map((a) => {
                const on = accountIds.includes(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggleAccount(a.id)}
                    className={
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors " +
                      (on ? "border-accent bg-accent/5" : "border-line hover:border-accent/40")
                    }
                  >
                    <PlatformIcon platform={a.platform} size={20} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-sumi">{a.handle ?? PLATFORM_LABEL[a.platform]}</span>
                      <span className="block text-[10px] text-faint">{PLATFORM_LABEL[a.platform]}</span>
                    </span>
                    {on && <span className="ml-auto text-accent">✓</span>}
                  </button>
                );
              })}
            </div>
            {!manual && selectedAccounts.length > 0 && (
              <p className="text-[11px] text-faint">
                選んだ {selectedAccounts.length} 個のプラットフォームに、承認後 Buffer 経由で投稿されます（連携済みの場合）。
              </p>
            )}
          </div>

          <label
            className={
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line py-10 text-center transition-colors hover:border-accent " +
              (busy ? "pointer-events-none opacity-60" : "")
            }
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*,image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !isVideo(f) && igType === "reel") setIgType("post");
              }}
            />
            <span className="text-sm text-sumi">{file ? file.name : "動画 / 画像を選択"}</span>
            <span className="text-[11px] text-faint">mp4 / mov / jpg（最大500MB）</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">キャプション</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder="投稿の本文…"
              className="zg-input resize-none"
            />
          </label>

          {!manual && (
            <label className="flex flex-col gap-1.5">
              <span className="zg-eyebrow-ja">ハッシュタグ（任意）</span>
              <textarea
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                rows={2}
                placeholder="#example #tags"
                className="zg-input resize-none"
              />
              <span className="text-[11px] text-faint">承認されると、投稿の本文末尾にハッシュタグが付いて投稿されます。</span>
            </label>
          )}

          {(anyIg || !manual) && (
            <div className={"grid gap-4 " + (anyIg && !manual ? "grid-cols-2" : "grid-cols-1")}>
              {anyIg && (
                <label className="flex flex-col gap-1.5">
                  <span className="zg-eyebrow-ja">投稿タイプ（Instagram）</span>
                  <select value={igType} onChange={(e) => setIgType(e.target.value as IgType)} className="zg-input">
                    {(!file || isVideo(file)) && <option value="reel">リール</option>}
                    <option value="post">フィード投稿</option>
                    <option value="story">ストーリー</option>
                  </select>
                </label>
              )}
              {!manual && (
                <label className="flex flex-col gap-1.5">
                  <span className="zg-eyebrow-ja">希望投稿日時（任意）</span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    min={minDt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="zg-input"
                  />
                </label>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
          {done && (
            <div className="rounded-xl border border-line bg-bg p-3 text-sm text-sumi">
              {manual
                ? "✅ 承認待ちです。承認されたら自分で投稿し、URLを登録すると計測が始まります。"
                : "✅ 提出しました。主催者の承認をお待ちください。"}
            </div>
          )}

          <button type="button" onClick={submit} disabled={busy || !file || selectedAccounts.length === 0} className="zg-capsule-accent disabled:opacity-50">
            {busy ? "アップロード中…" : prefill ? "再提出する" : manual ? "承認をもらう" : "提出する"}
          </button>
        </>
      )}
    </section>
  );
}
