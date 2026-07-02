"use client";

// web/components/CampaignCard.tsx — キャンペーン単位のドリルダウンセクション

import { VideoRow } from "@/components/VideoRow";
import { PlatformIcon } from "@/components/PlatformIcon";
import { formatYen } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { CampaignSummary, Platform } from "@/lib/types";

const PLATFORM_ORDER: Platform[] = ["youtube", "instagram", "tiktok"];
const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export function CampaignCard({
  campaign,
  onDeleteVideo,
  onRenameVideo,
  onLeave,
  platformFilter = "all",
}: {
  campaign: CampaignSummary;
  onDeleteVideo?: (trackedVideoId: string) => void;
  onRenameVideo?: (trackedVideoId: string, currentTitle: string | null) => void;
  onLeave?: (campaignId: string, title: string) => void;
  platformFilter?: Platform | "all";
}) {
  const now = useNow(1000); // 次回計測カウントダウンをライブ更新
  // 動画をプラットフォーム別にグループ化（YouTube / Instagram / TikTok 順）＋絞り込み
  const groups = PLATFORM_ORDER.filter((p) => platformFilter === "all" || p === platformFilter)
    .map((p) => ({ platform: p, videos: campaign.videos.filter((v) => v.platform === p) }))
    .filter((g) => g.videos.length > 0);
  if (groups.length === 0) return null; // 絞り込みで該当なし → この案件は表示しない
  const ended = campaign.status === "ended";
  return (
    <section className={ended ? "rounded-xl bg-line p-3 opacity-60 grayscale" : ""}>
      {/* ヘッダー: タイトル + 統計 */}
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="flex min-w-0 items-center gap-2 truncate font-sans text-base font-medium text-sumi">
          <span className="truncate">{campaign.title}</span>
          {ended && <span className="shrink-0 text-[10px] font-normal text-faint">終了</span>}
        </h3>
        <div className="flex shrink-0 items-baseline gap-3 text-xs tabular-nums">
          <span className="font-display text-faint">
            アクティブ {campaign.activeVideos}本 ・ 計測終了 {campaign.retiredVideos}本
          </span>
          <span className="font-display text-sumi">
            {formatYen(campaign.totalBillableAmount)}
          </span>
          {onLeave ? (
            <button
              type="button"
              onClick={() => onLeave(campaign.campaignId, campaign.title)}
              className="zg-capsule text-mid"
            >
              抜ける
            </button>
          ) : null}
        </div>
      </div>

      {/* 案件キャップ進捗は案件セレクタ直下（定位置）に表示するため、カード内では出さない */}

      {/* 動画行（プラットフォーム別に分別。見出しを明確に区切る） */}
      <div className="mt-8 space-y-9">
        {groups.map((g) => (
          <div key={g.platform}>
            <div className="mb-2 flex items-center gap-2.5 border-b border-line pb-1.5">
              <PlatformIcon platform={g.platform} size={20} />
              <span className="text-sm text-sumi">{PLATFORM_LABEL[g.platform]}</span>
              <span className="font-display text-[11px] text-faint">{g.videos.length}本</span>
            </div>
            <div>
              {g.videos.map((video, i) => (
                <div
                  key={video.trackedVideoId}
                  className={i < g.videos.length - 1 ? "hairline" : ""}
                >
                  <VideoRow video={video} onDelete={onDeleteVideo} onRename={onRenameVideo} now={now} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
