"use client";

// web/components/SubmissionApprovals.tsx — 提出動画の承認（オーガナイザー）
// pending を確認 → 承認すると Buffer に予約投稿（+Driveアーカイブ）。
// 却下は理由を添えて行い、ユーザー側にポップアップで通知される。承認/却下はログに残る。

import { useCallback, useEffect, useMemo, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { PlatformIcon } from "@/components/PlatformIcon";

type Platform = "youtube" | "tiktok" | "instagram";

interface AuditEntry {
  action: string;
  reason: string | null;
  at: string;
}
interface Submission {
  id: string;
  userId: string;
  userName: string;
  internalId: string | null;
  publicUrl: string;
  filename: string | null;
  mediaType: "video" | "image";
  submissionType: "auto" | "manual";
  trackedVideoId: string | null;
  groupId: string | null;
  platform: Platform | null;
  handle: string | null;
  igType: "post" | "reel" | "story" | null;
  caption: string | null;
  hashtags: string | null;
  scheduledAt: string | null;
  status: "pending" | "approved" | "rejected";
  bufferResult: string | null;
  rejectReason: string | null;
  driveFolder: string | null;
  reviewedAt: string | null;
  createdAt: string;
  log: AuditEntry[];
}

const IG_LABEL: Record<string, string> = { post: "フィード投稿", reel: "リール", story: "ストーリー" };
const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SubmissionApprovals() {
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { caption: string }>>({});
  const [rejecting, setRejecting] = useState<Record<string, string>>({}); // id → 却下理由（入力中＝却下モード）
  const [err, setErr] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);

  // 自動承認トグル（ONにすると提出が届き次第そのまま承認される）
  async function toggleAutoApprove() {
    const next = !autoApprove;
    if (next && !window.confirm("自動承認をONにしますか？\n以降の提出は届き次第そのまま承認され、自動でBuffer投稿まで進みます（手動は承認のみ）。")) return;
    setTogglingAuto(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/submission-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "set_auto_approve", value: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; auto_approve?: boolean };
      if (res.ok && j.ok) setAutoApprove(Boolean(j.auto_approve));
    } finally {
      setTogglingAuto(false);
    }
  }

  // 提出ログを削除（本当に削除しますか?確認のうえ）。承認/却下済みの記録整理用。
  async function deleteSubmission(s: Submission) {
    if (!window.confirm("この提出ログを削除しますか？\n（投稿済み・トラッキング済みのものはそのまま残り、記録だけ消えます）")) return;
    setDeletingId(s.id);
    setErr((p) => ({ ...p, [s.id]: "" }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/submission-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: s.id, action: "delete" }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr((p) => ({ ...p, [s.id]: j.error ?? "削除に失敗しました" }));
        return;
      }
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { submissions?: Submission[]; autoApprove?: boolean };
      const subs = json.submissions ?? [];
      setItems(subs);
      setAutoApprove(Boolean(json.autoApprove));
      const e: Record<string, { caption: string }> = {};
      for (const s of subs) e[s.id] = { caption: s.caption ?? "" };
      setEdit(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(s: Submission) {
    const msg = s.submissionType === "manual"
      ? "この動画を承認しますか？\n承認するとクリエイターが投稿します（投稿前の承認）。投稿後にURL登録で計測が始まります。"
      : "この動画を承認しますか？\n選択された全プラットフォームのうち、Buffer 連携済みのアカウントへ投稿されます（未連携は承認のみ）。";
    if (!window.confirm(msg)) return;
    setBusyId(s.id);
    setErr((p) => ({ ...p, [s.id]: "" }));
    try {
      const ed = edit[s.id] ?? { caption: "" };
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/submission-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: s.id, action: "approve", caption: ed.caption }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr((p) => ({ ...p, [s.id]: j.error ?? "処理に失敗しました" }));
        if (res.status === 409) await load(); // 別タブ/別主催者が処理済み → 最新化
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(s: Submission) {
    const reason = (rejecting[s.id] ?? "").trim();
    setBusyId(s.id);
    setErr((p) => ({ ...p, [s.id]: "" }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/submission-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: s.id, action: "reject", reason }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr((p) => ({ ...p, [s.id]: j.error ?? "処理に失敗しました" }));
        if (res.status === 409) await load();
        return;
      }
      setRejecting((p) => {
        const n = { ...p };
        delete n[s.id];
        return n;
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // 承認待ちは group_id でまとめる（複数プラットフォーム提出を1カード・1承認に）
  const pendingGroups = useMemo(() => {
    const groups = new Map<string, Submission[]>();
    for (const s of items) {
      if (s.status !== "pending") continue;
      const key = s.groupId ?? s.id;
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    return [...groups.values()];
  }, [items]);
  const reviewed = useMemo(() => items.filter((s) => s.status !== "pending"), [items]);

  function metaRow(s: Submission) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {s.platform && <PlatformIcon platform={s.platform} size={16} />}
        <span className="truncate text-sm text-sumi">{s.userName}</span>
        {s.handle && <span className="truncate text-[11px] text-faint">@{s.handle.replace(/^@/, "")}</span>}
        {s.platform === "instagram" && s.igType && (
          <span className="text-[10px] text-faint">{IG_LABEL[s.igType] ?? s.igType}</span>
        )}
        {s.platform && s.platform !== "instagram" && (
          <span className="text-[10px] text-faint">{PLATFORM_LABEL[s.platform]}</span>
        )}
      </div>
    );
  }

  // 提出はアップロードされた動画/画像。手動も投稿前の動画を上げるので同じプレビュー。
  // 重い動画/.mov でページが固まらないよう preload="none"（タップで読み込み）＋別タブで開くフォールバック。
  function mediaPreview(s: Submission, maxH: string) {
    return (
      <div>
        <div className="overflow-hidden rounded-lg border border-line bg-black/5">
          {s.mediaType === "video" ? (
            <video src={s.publicUrl} controls preload="none" playsInline className={`${maxH} w-full`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.publicUrl} alt={s.filename ?? ""} loading="lazy" className={`${maxH} w-full object-contain`} />
          )}
        </div>
        {s.mediaType === "video" && (
          <a href={s.publicUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-accent">
            再生されない場合は別タブで開く / ダウンロード ↗
          </a>
        )}
      </div>
    );
  }

  function pendingCard(group: Submission[]) {
    const s = group[0];
    const ed = edit[s.id] ?? { caption: "" };
    const inReject = s.id in rejecting;
    const isManual = s.submissionType === "manual";
    const multi = group.length > 1;
    return (
      <div key={s.id} className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-3">
          {metaRow(s)}
          <span className="shrink-0 text-[10px] text-accent">承認待ち</span>
        </div>
        {multi && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-faint">投稿先 {group.length} 件:</span>
            {group.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-mid">
                {g.platform && <PlatformIcon platform={g.platform} size={12} />}
                {g.handle ? `@${g.handle.replace(/^@/, "")}` : g.platform ? PLATFORM_LABEL[g.platform] : ""}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2">{mediaPreview(s, "max-h-72")}</div>

        <div className="mt-3 space-y-2">
          <textarea
            value={ed.caption}
            onChange={(e) => setEdit((p) => ({ ...p, [s.id]: { caption: e.target.value } }))}
            rows={2}
            placeholder="キャプション（編集可）"
            className="zg-input resize-none text-sm"
          />
          {!isManual && s.hashtags && (
            <div className="rounded-lg border border-line bg-bg px-3 py-2 text-[11px]">
              <span className="text-faint">ハッシュタグ（投稿に付与）:</span> <span className="text-accent">{s.hashtags}</span>
            </div>
          )}
          {isManual ? (
            <div className="rounded-lg border border-line bg-bg px-3 py-2 text-[11px] text-mid">
              <span className="text-sumi">投稿前の承認</span>です。承認するとクリエイターが投稿し、<span className="text-sumi">投稿後のURL登録で計測</span>が始まります。
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-bg px-3 py-2 text-[11px] text-mid">
              {s.scheduledAt ? (
                <>予約希望: <span className="text-sumi">{fmtDateTime(s.scheduledAt)}</span></>
              ) : (
                <span className="text-faint">予約日時の指定なし（Buffer のキューに追加）</span>
              )}
              <span className="text-faint"> ・ 承認で Buffer 連携済みプラットフォームへ投稿</span>
            </div>
          )}

          {err[s.id] && <p className="text-xs text-red-500">{err[s.id]}</p>}

          {inReject ? (
            <div className="space-y-2 rounded-lg border border-[#A8443A]/25 bg-[#A8443A]/5 p-2.5">
              <span className="zg-eyebrow-ja text-[#A8443A]">却下理由（ユーザーに表示されます）</span>
              <textarea
                value={rejecting[s.id]}
                onChange={(e) => setRejecting((p) => ({ ...p, [s.id]: e.target.value }))}
                rows={2}
                autoFocus
                placeholder="例：商品が映っていません／別アングルでお願いします"
                className="zg-input resize-none text-sm"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => confirmReject(s)}
                  disabled={busyId === s.id}
                  className="zg-capsule border-transparent bg-[#A8443A] text-white disabled:opacity-50"
                >
                  {busyId === s.id ? "処理中…" : "却下を確定"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRejecting((p) => {
                      const n = { ...p };
                      delete n[s.id];
                      return n;
                    })
                  }
                  disabled={busyId === s.id}
                  className="zg-capsule"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => approve(s)}
                disabled={busyId === s.id}
                className="zg-capsule-accent disabled:opacity-50"
              >
                {busyId === s.id ? "処理中…" : "承認"}
              </button>
              <button
                type="button"
                onClick={() => setRejecting((p) => ({ ...p, [s.id]: "" }))}
                disabled={busyId === s.id}
                className="zg-capsule text-[#A8443A] disabled:opacity-50"
              >
                却下
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function reviewedCard(s: Submission) {
    const ok = s.status === "approved";
    return (
      <div key={s.id} className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-3">
          {metaRow(s)}
          <span
            className={
              "shrink-0 text-[10px] " +
              (!ok || s.bufferResult === "post_failed"
                ? "text-[#A8443A]"
                : s.bufferResult === "unscheduled"
                  ? "text-accent"
                  : "text-status-completed")
            }
          >
            {!ok
              ? "却下"
              : s.bufferResult === "post_failed"
                ? "承認済み（投稿失敗・要Buffer再連携）"
                : s.submissionType === "manual"
                  ? (s.trackedVideoId ? "承認済み（計測中）" : "承認済み（投稿待ち）")
                  : s.bufferResult === "unscheduled"
                    ? "承認済み（未予約）"
                    : s.bufferResult === "no_channel"
                      ? "承認済み（手動）"
                      : "承認済み・予約"}
          </span>
        </div>

        <div className="mt-2">{mediaPreview(s, "max-h-56")}</div>

        <div className="mt-2 space-y-1 text-[11px] text-faint">
          {s.caption && <div className="text-mid">{s.caption}</div>}
          {ok && s.scheduledAt && <div>予約日時: {fmtDateTime(s.scheduledAt)}</div>}
          {!ok && s.rejectReason && <div className="text-[#A8443A]">却下理由: {s.rejectReason}</div>}
          {s.driveFolder && <div>Drive: {s.driveFolder}</div>}
        </div>

        {/* 監査ログ */}
        {s.log.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-faint">操作ログ（{s.log.length}）</summary>
            <ul className="mt-1 space-y-0.5 border-l border-line pl-3 text-[10px] text-faint">
              {s.log.map((l, i) => (
                <li key={i}>
                  {fmtDateTime(l.at)} ・{" "}
                  {l.action === "approved" ? "承認" : l.action === "rejected" ? "却下" : l.action === "scheduled" ? "予約" : l.action}
                  {l.reason ? ` ・ ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}

        {err[s.id] && <p className="mt-2 text-xs text-red-500">{err[s.id]}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => deleteSubmission(s)}
            disabled={deletingId === s.id}
            className="zg-capsule text-[10px] text-[#A8443A] disabled:opacity-50"
          >
            {deletingId === s.id ? "削除中…" : "削除"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <span className="zg-eyebrow-ja">提出の承認</span>
          {/* 自動承認トグル */}
          <button
            type="button"
            onClick={toggleAutoApprove}
            disabled={togglingAuto}
            className="flex shrink-0 items-center gap-2 disabled:opacity-50"
            aria-pressed={autoApprove}
          >
            <span className="text-[11px] text-mid">自動承認</span>
            <span className={"relative h-5 w-9 rounded-full transition-colors " + (autoApprove ? "bg-accent" : "bg-line")}>
              <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " + (autoApprove ? "left-[18px]" : "left-0.5")} />
            </span>
          </button>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          {autoApprove
            ? "自動承認ON：提出が届き次第そのまま承認され、Buffer連携済みは自動投稿されます。承認ログは残ります。"
            : "手動は「投稿前の承認」。承認するとクリエイターが投稿し、投稿後のURL登録で計測。自動は承認で Buffer 投稿。却下理由はユーザーに通知され、修正して再提出できます。"}
        </p>
      </div>

      {loading ? (
        <div className="py-6 text-sm text-faint">読み込み中…</div>
      ) : (
        <>
          <div>
            <div className="zg-eyebrow-ja mb-2">承認待ち（{pendingGroups.length}）</div>
            {pendingGroups.length === 0 ? (
              <div className="text-sm text-faint">承認待ちの提出はありません</div>
            ) : (
              <div className="space-y-3">{pendingGroups.map(pendingCard)}</div>
            )}
          </div>
          {reviewed.length > 0 && (
            <div>
              <div className="zg-eyebrow-ja mb-2">処理済み（{reviewed.length}）</div>
              <div className="space-y-3">{reviewed.map(reviewedCard)}</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
