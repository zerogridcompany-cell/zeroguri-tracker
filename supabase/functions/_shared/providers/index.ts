// _shared/providers/index.ts — platform → ViewProvider 解決
import type { Platform, ViewProvider } from "./types.ts";
import { youtubeProvider } from "./youtube.ts";
import { tiktokProvider } from "./tiktok.ts";
import { instagramProvider } from "./instagram.ts";

const REGISTRY: Record<Platform, ViewProvider> = {
  youtube: youtubeProvider,
  tiktok: tiktokProvider,
  instagram: instagramProvider,
};

export function getProvider(platform: Platform): ViewProvider {
  const p = REGISTRY[platform];
  if (!p) throw new Error(`Unknown platform: ${platform}`);
  return p;
}

export type { Platform, ViewProvider };
