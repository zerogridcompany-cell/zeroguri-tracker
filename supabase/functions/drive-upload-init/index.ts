// drive-upload-init — 動画提出のアップロード先を用意（verify_jwt=true）
// 指定の共有フォルダ配下に「名前フォルダ → 日付フォルダ」を作り、レジューマブルアップロードURLを返す。
// 実ファイルは大きいので関数を経由せず、クライアントが返却URLへ直接 PUT する。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";
import { findOrCreateFolder, getDriveAccessToken, startResumableUpload } from "../_shared/google.ts";

function mkName(p: Record<string, unknown> | null | undefined, fallback: string): string {
  const n = [p?.last_name_kanji, p?.first_name_kanji].filter(Boolean).join(" ") ||
    (p?.name_kanji as string | null) || "";
  return (n || fallback).trim();
}

// JST の YYYY-MM-DD
function jstDate(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const filename = (body.filename as string)?.trim();
    const mimeType = (body.mimeType as string) || "application/octet-stream";
    if (!filename) return error("filename required", 400);

    const parent = Deno.env.get("GOOGLE_DRIVE_PARENT");
    if (!parent) return error("GOOGLE_DRIVE_PARENT not configured", 500);

    const db = admin();
    const { data: prof } = await db
      .from("profiles")
      .select("internal_id, name_kanji, last_name_kanji, first_name_kanji")
      .eq("user_id", user.id).maybeSingle();
    const internalId = (prof?.internal_id as string | null) ?? user.id.slice(0, 8);
    const personName = mkName(prof, internalId);
    // 同名衝突を避けて内部IDを併記（名前優先）
    const folderName = personName === internalId ? internalId : `${personName}（${internalId}）`;

    const token = await getDriveAccessToken();
    const userFolder = await findOrCreateFolder(token, folderName, parent);
    const dateFolder = await findOrCreateFolder(token, jstDate(), userFolder);
    const uploadUrl = await startResumableUpload(token, dateFolder, filename, mimeType);

    return json({ uploadUrl, folder: `${folderName}/${jstDate()}` });
  } catch (e) {
    return error(String(e), 500);
  }
});
