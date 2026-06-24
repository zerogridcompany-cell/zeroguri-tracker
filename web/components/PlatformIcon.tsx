// web/components/PlatformIcon.tsx — プラットフォームを折り紙の家紋アイコンで表示

import { ORIGAMI } from "@/components/Origami";
import type { Platform } from "@/lib/types";

export function PlatformIcon({
  platform,
  size = 24,
}: {
  platform: Platform;
  size?: number;
}) {
  const Icon = ORIGAMI[platform];
  return (
    <span
      aria-label={platform}
      title={platform}
      className="inline-flex shrink-0 items-center justify-center"
    >
      <Icon size={size} />
    </span>
  );
}
