// _shared/drive-archive.ts — 提出動画を Drive(名前/日付) へアーカイブ（ベストエフォート）。
// 承認/予約の両エンドポイントから共用。失敗しても呼び出し側の処理は成立させる。
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateFolder, getDriveAccessToken, uploadUrlToFolder } from "./google.ts";

function mkName(p: Record<string, unknown> | null | undefined, fallback: string): string {
  return ([p?.last_name_kanji, p?.first_name_kanji].filter(Boolean).join(" ") ||
    (p?.name_kanji as string | null) || fallback).trim();
}
const jstDate = (iso?: string | null): string =>
  new Date((iso ? Date.parse(iso) : Date.now()) + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function archiveToDrive(
  db: SupabaseClient,
  sub: Record<string, unknown>,
  id: string,
): Promise<string | null> {
  try {
    const parent = Deno.env.get("GOOGLE_DRIVE_PARENT");
    if (!parent) return null;
    const { data: prof } = await db
      .from("profiles").select("internal_id, name_kanji, last_name_kanji, first_name_kanji")
      .eq("user_id", sub.user_id).maybeSingle();
    const internalId = (prof?.internal_id as string | null) ?? String(sub.user_id).slice(0, 8);
    const personName = mkName(prof, internalId);
    const folderName = personName === internalId ? internalId : `${personName}（${internalId}）`;
    const dateStr = jstDate(sub.created_at as string | null);
    const token = await getDriveAccessToken();
    const userFolder = await findOrCreateFolder(token, folderName, parent);
    const dateFolder = await findOrCreateFolder(token, dateStr, userFolder);
    await uploadUrlToFolder(
      token, dateFolder,
      (sub.filename as string) || `submission_${id}.mp4`,
      (sub.media_type as string) === "image" ? "image/jpeg" : "video/mp4",
      sub.public_url as string,
    );
    return `${folderName}/${dateStr}`;
  } catch (_e) {
    return null;
  }
}
