"use client";

// web/components/CreatorReservations.tsx — 予約投稿（クリエイター）
// 承認済みの動画を、カレンダー基準で予約できる。提出時に日時を付けて出せば（セット）承認時に投稿される。
// 承認だけ先にもらった動画は「予約待ち」から日時を選んで後から予約投稿する。
// IG は Buffer に予約。YT/TikTok は手動投稿の予定日時を記録。

import { useCallback, useEffect, useMemo, useState } from "react";
import { functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ScheduleCalendar, localKey, REAL_BUFFER, type CalEvent } from "@/components/ScheduleCalendar";

type Platform = "youtube" | "tiktok" | "instagram";

interface Sub {
  id: string;
  public_url: string;
  media_type: "video" | "image";
  platform: Platform | null;
  handle: string | null;
  caption: string | null;
  scheduled_at: string | null;
  status: "pending" | "approved" | "rejected";
  buffer_result: string | null;
  linked_account_id: string | null;
  created_at: string;
}

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDayLabel(key: string | null): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日（${wd}）`;
}
function toLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function CreatorReservations() {
  const [items, setItems] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({}); // id → datetime-local
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState<Record<string, boolean>>({}); // linked_account_id → Buffer接続済み
  const minDt = useMemo(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), []);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      const [subsRes, accRes] = await Promise.all([
        supabase
          .from("video_submissions")
          .select("id, public_url, media_type, platform, handle, caption, scheduled_at, status, buffer_result, linked_account_id, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),
        supabase.from("linked_accounts").select("id, buffer_channel_id").eq("user_id", uid),
      ]);
      setItems((subsRes.data ?? []) as Sub[]);
      const cmap: Record<string, boolean> = {};
      for (const a of accRes.data ?? []) cmap[a.id as string] = Boolean(a.buffer_channel_id);
      setConnected(cmap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduled = useMemo(() => items.filter((s) => s.status === "approved" && s.scheduled_at), [items]);
  const awaiting = useMemo(
    () => items.filter((s) => s.status === "approved" && !s.scheduled_at && !REAL_BUFFER(s.buffer_result)),
    [items],
  );
  const pending = useMemo(() => items.filter((s) => s.status === "pending"), [items]);

  const events: CalEvent[] = useMemo(
    () =>
      scheduled
        .map((s) => {
          const key = localKey(s.scheduled_at);
          return key ? { id: s.id, key, platform: s.platform, tone: "scheduled" as const } : null;
        })
        .filter(Boolean) as CalEvent[],
    [scheduled],
  );

  const dayItems = useMemo(
    () => scheduled.filter((s) => localKey(s.scheduled_at) === selectedKey).sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1)),
    [scheduled, selectedKey],
  );

  async function schedule(s: Sub) {
    const val = pick[s.id];
    if (!val) {
      setErr((p) => ({ ...p, [s.id]: "日時を選んでください" }));
      return;
    }
    setBusyId(s.id);
    setErr((p) => ({ ...p, [s.id]: "" }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/submission-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: s.id, scheduledAt: new Date(val).toISOString() }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr((p) => ({ ...p, [s.id]: j.error ?? "予約に失敗しました" }));
        if (res.status === 409) await load();
        return;
      }
      setPick((p) => {
        const n = { ...p };
        delete n[s.id];
        return n;
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function media(s: Sub) {
    return (
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-black/5">
        {s.media_type === "video" ? (
          <video src={s.public_url} preload="metadata" className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.public_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
    );
  }

  // mode: "scheduled"（予約済み・時刻表示）/ "schedulable"（予約待ち・入力）/ "pending"（承認待ち）
  function row(s: Sub, mode: "scheduled" | "schedulable" | "pending") {
    // 非IG（手動投稿）の予約済みは日時変更可。IG はBuffer予約後ロック。
    const canEdit = mode === "schedulable" || (mode === "scheduled" && s.platform !== "instagram");
    // IG は投稿先アカウントが Buffer 接続済みでないと自動予約できない
    const igBlocked = s.platform === "instagram" && !(s.linked_account_id && connected[s.linked_account_id]);
    return (
      <div key={s.id} className="rounded-xl border border-line p-2.5">
        <div className="flex items-center gap-2.5">
          {media(s)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {s.platform && <PlatformIcon platform={s.platform} size={14} />}
              <span className="truncate text-sm text-sumi">
                {s.handle ? `@${s.handle.replace(/^@/, "")}` : s.platform ? PLATFORM_LABEL[s.platform] : "—"}
              </span>
              {mode === "scheduled" && s.scheduled_at && (
                <span className="ml-auto shrink-0 font-display text-sm text-accent">{fmtTime(s.scheduled_at)}</span>
              )}
              {mode === "pending" && (
                <span className="ml-auto shrink-0 text-[10px] text-accent">
                  {s.scheduled_at ? `${fmtDateTime(s.scheduled_at)} 希望` : "承認待ち"}
                </span>
              )}
            </div>
            {s.caption && <div className="mt-0.5 truncate text-[11px] text-faint">{s.caption}</div>}
          </div>
        </div>

        {canEdit && igBlocked && mode === "schedulable" && (
          <p className="mt-2 rounded-lg border border-[#A8443A]/25 bg-[#A8443A]/5 px-2.5 py-1.5 text-[11px] text-[#A8443A]">
            このInstagramアカウントはまだBufferに接続されていません。主催者が接続すると予約できます。
          </p>
        )}
        {canEdit && !igBlocked && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="datetime-local"
              value={pick[s.id] ?? (mode === "scheduled" ? toLocal(s.scheduled_at) : "")}
              min={minDt}
              onChange={(e) => setPick((p) => ({ ...p, [s.id]: e.target.value }))}
              className="zg-input flex-1 text-sm"
            />
            <button
              type="button"
              onClick={() => schedule(s)}
              disabled={busyId === s.id}
              className="zg-capsule-accent shrink-0 disabled:opacity-50"
            >
              {busyId === s.id ? "予約中…" : mode === "scheduled" ? "日時変更" : "予約する"}
            </button>
          </div>
        )}
        {err[s.id] && <p className="mt-1 text-xs text-red-500">{err[s.id]}</p>}
        {mode === "scheduled" && s.platform !== "instagram" && (
          <p className="mt-1 text-[10px] text-faint">※ 手動投稿の予定（その時間にご自身で投稿してください）</p>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="zg-eyebrow-ja">予約投稿</span>
        <p className="mt-1 text-[11px] leading-relaxed text-mid">
          提出時に日時を付ければ承認後にその時間で投稿されます。承認だけ先にもらった動画は、下の「予約待ち」から日時を選んで予約できます。
        </p>
      </div>

      {loading ? (
        <div className="py-6 text-sm text-faint">読み込み中…</div>
      ) : (
        <>
          <ScheduleCalendar
            events={events}
            selectedKey={selectedKey}
            onSelectDay={setSelectedKey}
            onMonthChange={(y, m) =>
              setSelectedKey((k) => (k && k.startsWith(`${y}-${pad2(m + 1)}`) ? k : null))
            }
          />

          {selectedKey && (
            <div>
              <div className="zg-eyebrow-ja mb-2">{fmtDayLabel(selectedKey)} の予約（{dayItems.length}）</div>
              {dayItems.length === 0 ? (
                <div className="text-sm text-faint">この日の予約はありません</div>
              ) : (
                <div className="space-y-2">{dayItems.map((s) => row(s, "scheduled"))}</div>
              )}
            </div>
          )}

          {/* 予約待ち（承認済み・要予約）＝ここから予約する */}
          <div>
            <div className="zg-eyebrow-ja mb-2 text-accent">予約待ち（承認済み・{awaiting.length}）</div>
            {awaiting.length === 0 ? (
              <div className="text-sm text-faint">予約できる動画はありません</div>
            ) : (
              <div className="space-y-2">{awaiting.map((s) => row(s, "schedulable"))}</div>
            )}
          </div>

          {pending.length > 0 && (
            <div>
              <div className="zg-eyebrow-ja mb-2">承認待ち（{pending.length}）</div>
              <div className="space-y-2">{pending.map((s) => row(s, "pending"))}</div>
            </div>
          )}

          {items.length === 0 && (
            <div className="text-sm text-faint">まだ提出した動画はありません</div>
          )}
        </>
      )}
    </section>
  );
}
