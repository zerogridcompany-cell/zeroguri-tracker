// web/lib/links.ts — プラットフォームのプロフィール/動画 URL を生成（リンククリックで外部へ飛ぶ用）

/** @handle + platform → プロフィールURL。組めなければ null。 */
export function profileUrl(platform: string, handle?: string | null): string | null {
  const h = (handle ?? "").replace(/^@+/, "").trim();
  if (!h) return null;
  if (platform === "youtube") return `https://www.youtube.com/@${h}`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return null;
}
