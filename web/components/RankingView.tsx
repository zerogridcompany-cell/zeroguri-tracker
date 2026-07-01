"use client";

// web/components/RankingView.tsx — ランキング（タブとして埋め込み）
// 稼いだ額（byEarnings）で並べ替えたクリエイターの順位表。再生数は副次表示。
// 自己完結のコンテンツのみ（ページヘッダー / サインアウトは持たない）。

import { useCallback, useEffect, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { formatYen, formatNumber } from "@/lib/format";
import { profileUrl } from "@/lib/links";
import { PlatformIcon } from "@/components/PlatformIcon";
import { PostingCalendar, type Posting } from "@/components/PostingCalendar";
import type { Platform } from "@/lib/types";

interface LinkedAccount {
  platform: Platform;
  handle: string | null;
}
interface RankEntry {
  rank: number;
  userId: string;
  name: string;
  internalId: string;
  views: number;
  earnings: number;
  videos: number;
  goalMin?: number | null;
  goalMax?: number | null;
  accounts?: LinkedAccount[];
  posting?: Posting | null;
}
interface RankingData {
  byEarnings: RankEntry[];
}

export function RankingView() {
  const [data, setData] = useState<RankingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // タップで開いている行（userId）。選択したユーザーの投稿状況を下に表示する。
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/ranking`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as RankingData);
    } catch {
      setError("ランキングの読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data ? data.byEarnings : [];

  return (
    <div className="space-y-6">
      <span className="zg-eyebrow-ja">ランキング（稼いだ額）</span>

      {/* 本体 */}
      {error ? (
        <div className="py-16 text-center text-sm text-faint">{error}</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-faint">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-faint">まだランキングがありません</div>
      ) : (
        <div>
          {rows.map((r, i) => {
            const open = openId === r.userId;
            return (
              <div
                key={r.internalId + "-" + r.rank}
                className={i < rows.length - 1 ? "hairline" : ""}
              >
                {/* 行: タップで投稿状況を開閉 */}
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.userId)}
                  aria-expanded={open}
                  className="zg-row w-full text-left"
                >
                  {/* 左: 順位 + 名前 + 内部ID */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={
                        "w-7 shrink-0 font-display text-lg tabular-nums" +
                        (r.rank <= 3 ? " text-accent" : " text-mid")
                      }
                    >
                      {r.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-sumi">{r.name}</div>
                      <div className="truncate font-display text-[10px] text-faint">
                        {r.internalId}
                      </div>
                    </div>
                  </div>

                  {/* 右: 稼いだ額（主）+ 再生数（下に小さく） */}
                  <div className="shrink-0 text-right">
                    <div className="font-display text-base font-semibold tabular-nums text-sumi">
                      {formatYen(r.earnings)}
                    </div>
                    <div className="font-display text-[10px] text-faint">
                      再生 {formatNumber(r.views)}
                    </div>
                  </div>
                </button>

                {/* 開いたら: 選択ユーザーのSNSリンク + 投稿状況 */}
                {open && (
                  <div className="space-y-3 pb-4 pt-1">
                    {/* SNSリンク（各アカウントのプロフィールへ） */}
                    {r.accounts && r.accounts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {r.accounts.map((a, j) => {
                          const href = profileUrl(a.platform, a.handle);
                          const label = a.handle ?? a.platform;
                          return href ? (
                            <a
                              key={a.platform + j}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="zg-capsule inline-flex items-center gap-1.5 hover:text-accent"
                              title={`${label} を開く`}
                            >
                              <PlatformIcon platform={a.platform} size={16} />
                              {label}
                            </a>
                          ) : (
                            <span
                              key={a.platform + j}
                              className="zg-capsule inline-flex items-center gap-1.5"
                            >
                              <PlatformIcon platform={a.platform} size={16} />
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-faint">SNSアカウントの連携がありません</div>
                    )}

                    {/* 投稿状況（日別の投稿本数・目標達成で色分け） */}
                    {r.posting ? (
                      <PostingCalendar posting={r.posting} goalMin={r.goalMin} goalMax={r.goalMax} />
                    ) : (
                      <div className="rounded-xl border border-line p-3 text-center text-[11px] text-faint">
                        投稿状況のデータがありません
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
