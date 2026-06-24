"use client";

// web/components/RankingView.tsx — ランキング（タブとして埋め込み）
// 稼いだ額（byEarnings）で並べ替えたクリエイターの順位表。再生数は副次表示。
// 自己完結のコンテンツのみ（ページヘッダー / サインアウトは持たない）。

import { useCallback, useEffect, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { formatYen, formatNumber } from "@/lib/format";

interface RankEntry {
  rank: number;
  name: string;
  internalId: string;
  views: number;
  earnings: number;
  videos: number;
}
interface RankingData {
  byEarnings: RankEntry[];
}

export function RankingView() {
  const [data, setData] = useState<RankingData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          {rows.map((r, i) => (
            <div
              key={r.internalId + "-" + r.rank}
              className={"zg-row" + (i < rows.length - 1 ? " hairline" : "")}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
