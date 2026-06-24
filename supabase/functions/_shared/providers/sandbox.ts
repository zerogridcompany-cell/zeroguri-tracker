// _shared/providers/sandbox.ts — 決定的な擬似成長シミュレータ
// 実 API クレデンシャル無しで tracking-tick の state machine を E2E で動かすために使う。
// contentId のハッシュから「飽和到達値 plateau」と「成長速度」を導出し、
// 経過時間に対して saturating curve で再生数を返す（同じ瞬間なら決定的）。
import type { Platform, ProviderProfile, ProviderVideo } from "./types.ts";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** contentId ごとの決定的な再生数（時間とともに plateau へ漸近）。 */
export function sandboxViews(contentId: string): number {
  const h = hash(contentId);
  // plateau: 4万〜64万（cap=50万 をまたぐので cap retire も発火する）
  const plateau = 40000 + (h % 600000);
  // 公開からの経過分（contentId から決定的な「公開時刻」を作る）
  const bornOffsetMin = (h % 20000); // 0〜約14日
  const ageMin = Math.max(0, Date.now() / 60000 - (Date.now() / 60000 - 14 * 24 * 60) - bornOffsetMin);
  // 時定数 ~3日。鈍化して stall retire も発火する。
  const tau = 3 * 24 * 60;
  const views = plateau * (1 - Math.exp(-ageMin / tau));
  return Math.floor(views);
}

export function sandboxFetchViews(contentIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of contentIds) m.set(id, sandboxViews(id));
  return m;
}

export function sandboxProfile(platform: Platform, seed = "demo"): ProviderProfile {
  const h = hash(platform + seed);
  return {
    platformUserId: `${platform}_sandbox_${h.toString(16)}`,
    handle: seed.startsWith("@") ? seed : `@sandbox_${platform}`,
    accountCreatedAt: new Date(Date.now() - (h % 60) * 86400000).toISOString(),
    followerCount: h % 100000,
    existingPostCount: h % 5,
    // sandbox では所有確認を素通しさせるためのマーカー（link-challenge-verify が isSandbox 時に bypass）。
    bioText: "sandbox account — ownership auto-verified",
  };
}

export function sandboxListVideos(platform: Platform, n = 5): ProviderVideo[] {
  const out: ProviderVideo[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${platform}_vid_${i}_${(hash(platform + i) % 9999).toString(16)}`;
    out.push({ contentId: id, title: `Sandbox ${platform} video ${i}`, views: sandboxViews(id) });
  }
  return out;
}
