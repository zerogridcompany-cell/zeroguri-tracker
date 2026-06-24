"use client";

// web/components/PayoutLedgerLog.tsx — ペイアウト済みログ（オーガナイザー専用）
// 「このアカウントのこの動画はもう支払い済み（計上対象外）」を1本ごとに表示。
// 案件で絞り、さらにユーザーで絞れる。間違いがあれば1本ごとにリセット（台帳から削除）
// → 再追加時に最初から計上される。
import { useCallback, useEffect, useMemo, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { PlatformIcon } from "@/components/PlatformIcon";
import { formatYen, formatNumber } from "@/lib/format";
import type { Platform } from "@/lib/types";

interface LedgerEntry {
  id: string;
  kind: "video" | "request";
  requestId: string | null;
  campaignId: string;
  campaign: string;
  userId: string;
  userName: string;
  internalId: string | null;
  platform: Platform | null;
  handle: string | null;
  contentId: string | null;
  title: string | null;
  paidViews: number;
  paidAmount: number;
  lastPaidAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function PayoutLedgerLog() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-ledger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "list" }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { entries?: LedgerEntry[] };
      setEntries(json.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 案件の選択肢
  const campaigns = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.campaignId, e.campaign);
    return [...m.entries()].map(([campaignId, title]) => ({ campaignId, title }));
  }, [entries]);

  // 案件で絞った後のユーザー選択肢（案件別 → さらにユーザー別）
  const usersInCampaign = useMemo(() => {
    const scoped = campaignFilter === "all" ? entries : entries.filter((e) => e.campaignId === campaignFilter);
    const m = new Map<string, string>();
    for (const e of scoped) m.set(e.userId, e.userName);
    return [...m.entries()].map(([userId, name]) => ({ userId, name }));
  }, [entries, campaignFilter]);

  const filtered = useMemo(() => {
    return entries.filter(
      (e) =>
        (campaignFilter === "all" || e.campaignId === campaignFilter) &&
        (userFilter === "all" || e.userId === userFilter),
    );
  }, [entries, campaignFilter, userFilter]);

  async function reset(e: LedgerEntry) {
    if (
      !window.confirm(
        `この支払いを取り消します。\n` +
          `この支払いに含まれる動画はすべて最初から計上され直し、対応する振込履歴も削除されます。`,
      )
    ) {
      return;
    }
    setBusyId(e.id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-ledger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "reset", requestId: e.requestId, id: e.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j?.error ?? "リセットに失敗しました");
        return;
      }
      // 同じ支払いの他動画もまとめて消えるので、一覧を取り直す
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="zg-eyebrow-ja">ペイアウト済みログ</span>
        <p className="mt-1 text-[11px] text-faint">
          支払い済みの再生数は計上対象外になります。間違いがあればリセットすると最初から計上され直します。
        </p>
      </div>

      {/* 絞り込み: 案件 → ユーザー */}
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="zg-eyebrow-ja">案件</span>
          <select
            className="zg-input cursor-pointer"
            value={campaignFilter}
            onChange={(e) => {
              setCampaignFilter(e.target.value);
              setUserFilter("all");
            }}
          >
            <option value="all">すべての案件</option>
            {campaigns.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="zg-eyebrow-ja">ユーザー</span>
          <select
            className="zg-input cursor-pointer"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="all">すべてのユーザー</option>
            {usersInCampaign.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="py-6 text-sm text-faint">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-sm text-faint">ペイアウト済みの動画はまだありません</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {e.kind === "video" && e.platform ? (
                      <PlatformIcon platform={e.platform} size={16} />
                    ) : null}
                    <span className="truncate text-sm text-sumi">
                      {e.kind === "video" ? (e.title ?? e.contentId) : "支払い（動画は計測対象外）"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {e.campaign} · {e.userName}
                    {e.handle ? ` · ${e.handle}` : ""}
                  </div>
                  <div className="mt-0.5 font-display text-[11px] text-faint">
                    {e.kind === "video" && (
                      <>支払い済み {formatNumber(e.paidViews)} 再生 · </>
                    )}
                    <span className="text-sumi">{formatYen(e.paidAmount)}</span> · {formatDate(e.lastPaidAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => reset(e)}
                  disabled={busyId === e.id}
                  className="zg-capsule shrink-0 text-[#A8443A] disabled:opacity-50"
                >
                  {busyId === e.id ? "リセット中…" : "リセット"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
