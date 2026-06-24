"use client";

// web/components/VideoTrendModal.tsx — 動画の再生数推移ドリルダウン（オーガナイザー）
// video-snapshots から1時間ごとのスナップショットを取得し、折れ線グラフ＋統計で表示。

import { useEffect, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { formatNumber } from "@/lib/format";

interface Snap {
  capturedAt: string;
  views: number;
  rawViews: number;
}
interface TrendData {
  video: {
    trackedVideoId: string;
    platform: string;
    contentId: string;
    title: string | null;
    url: string | null;
    cap: number;
    lastViews: number;
    lastCheckedAt: string | null;
  };
  snapshots: Snap[];
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) +
    " " +
    d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
  );
}

function TrendChart({ snaps }: { snaps: Snap[] }) {
  if (snaps.length < 2) {
    return (
      <div className="py-12 text-center text-xs text-faint">
        推移データがまだ十分にありません（1時間ごとに計測が進むと表示されます）
      </div>
    );
  }
  const W = 1000;
  const H = 320;
  const pad = { l: 10, r: 10, t: 16, b: 28 };
  const xs = snaps.map((s) => new Date(s.capturedAt).getTime());
  const ys = snaps.map((s) => s.views);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys, 1);
  const sx = (x: number) =>
    pad.l + (W - pad.l - pad.r) * (maxX === minX ? 0.5 : (x - minX) / (maxX - minX));
  const sy = (y: number) => H - pad.b - (H - pad.t - pad.b) * (y / maxY);
  const pts = snaps.map((s, i) => `${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  const area =
    `M${sx(xs[0]).toFixed(1)},${(H - pad.b).toFixed(1)} L` +
    pts.join(" L") +
    ` L${sx(xs[xs.length - 1]).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }}>
        {/* 上限の目安線 */}
        <line x1={pad.l} y1={pad.t} x2={W - pad.r} y2={pad.t} className="stroke-line" strokeWidth={1} />
        <path d={area} className="fill-accent" opacity={0.1} />
        <path
          d={line}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {snaps.map((s, i) => (
          <circle key={i} cx={sx(xs[i])} cy={sy(ys[i])} r={2.5} className="fill-accent" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-display text-[10px] text-faint">
        <span>{fmtDateTime(snaps[0].capturedAt)}</span>
        <span>最大 {formatNumber(maxY)}</span>
        <span>{fmtDateTime(snaps[snaps.length - 1].capturedAt)}</span>
      </div>
    </div>
  );
}

export function VideoTrendModal({
  trackedVideoId,
  open,
  onClose,
}: {
  trackedVideoId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<TrendData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !trackedVideoId) return;
    let alive = true;
    setData(null);
    setError("");
    void (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`${functionsUrl}/video-snapshots?trackedVideoId=${trackedVideoId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as TrendData;
        if (alive) setData(json);
      } catch {
        if (alive) setError("推移データの読み込みに失敗しました");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, trackedVideoId]);

  if (!open) return null;

  const snaps = data?.snapshots ?? [];
  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  const growth = first && last ? last.views - first.views : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-line bg-white p-6"
        role="dialog"
        aria-modal="true"
        aria-label="再生数の推移"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center text-faint transition-colors hover:text-sumi"
        >
          ×
        </button>

        <h2 className="zg-eyebrow-ja mb-1">再生数の推移</h2>
        <p className="mb-5 truncate text-sm text-sumi">
          {data?.video.title ?? data?.video.contentId ?? "—"}
        </p>

        {error ? (
          <div className="py-12 text-center text-sm text-faint">{error}</div>
        ) : !data ? (
          <div className="py-12 text-center text-sm text-faint">読み込み中…</div>
        ) : (
          <>
            {/* 統計 */}
            <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <div className="zg-eyebrow-ja">現在</div>
                <div className="font-display text-xl font-semibold tabular-nums text-sumi">
                  {formatNumber(data.video.lastViews)}
                </div>
              </div>
              <div>
                <div className="zg-eyebrow-ja">期間の伸び</div>
                <div className="font-display text-xl font-semibold tabular-nums text-accent">
                  +{formatNumber(growth)}
                </div>
              </div>
              <div>
                <div className="zg-eyebrow-ja">計測点</div>
                <div className="font-display text-xl tabular-nums text-mid">{snaps.length}</div>
              </div>
              {data.video.url && (
                <a
                  href={data.video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-end text-xs text-mid underline decoration-line underline-offset-2 hover:text-accent"
                >
                  動画を開く ↗
                </a>
              )}
            </div>

            <TrendChart snaps={snaps} />

            {/* 直近の明細 */}
            {snaps.length > 0 && (
              <div className="mt-6">
                <div className="zg-eyebrow-ja mb-2">1時間ごとの明細（直近）</div>
                <div className="max-h-44 overflow-y-auto">
                  {[...snaps].reverse().slice(0, 30).map((s, i, arr) => {
                    const prev = arr[i + 1];
                    const delta = prev ? s.views - prev.views : null;
                    return (
                      <div key={s.capturedAt} className="zg-row hairline">
                        <span className="font-display text-[11px] tabular-nums text-mid">
                          {fmtDateTime(s.capturedAt)}
                        </span>
                        <span className="flex items-baseline gap-3">
                          <span className="font-display text-sm tabular-nums text-sumi">
                            {formatNumber(s.views)}
                          </span>
                          {delta !== null && (
                            <span className="font-display text-[10px] tabular-nums text-faint">
                              {delta >= 0 ? "+" : ""}
                              {formatNumber(delta)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
