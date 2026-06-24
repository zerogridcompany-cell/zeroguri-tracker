// _shared/google.ts — Google Drive をサービスアカウントで操作。
// SA(JSON)は Supabase secret GOOGLE_DRIVE_SA に保存。JWT(RS256)→アクセストークン交換。

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let _cachedToken: { token: string; exp: number } | null = null;

/** SA の JWT を作ってアクセストークンを取得（1時間キャッシュ）。 */
export async function getDriveAccessToken(): Promise<string> {
  if (_cachedToken && _cachedToken.exp > Date.now() + 60_000) return _cachedToken.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_DRIVE_SA") ?? "{}");
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_DRIVE_SA not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const jwt = `${input}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(claims.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("google token: " + JSON.stringify(j).slice(0, 300));
  _cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

const DRIVE_Q = "supportsAllDrives=true&includeItemsFromAllDrives=true";

/** 親フォルダ直下の同名フォルダを探し、無ければ作る。folderId を返す。 */
export async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string,
): Promise<string> {
  // Drive クエリ用エスケープ: バックスラッシュ → クォートの順。
  const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const findRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_Q}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const found = await findRes.json();
  if (found.files && found.files.length > 0) return found.files[0].id as string;

  const createRes = await fetch(`https://www.googleapis.com/drive/v3/files?${DRIVE_Q}&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error("create folder failed: " + JSON.stringify(created).slice(0, 300));
  return created.id as string;
}

/** 公開URLのファイルを Drive の指定フォルダへストリームコピー（アーカイブ用）。fileId を返す。 */
export async function uploadUrlToFolder(
  token: string,
  folderId: string,
  filename: string,
  mimeType: string,
  sourceUrl: string,
): Promise<string> {
  const head = await fetch(sourceUrl, { method: "HEAD" });
  const size = head.headers.get("content-length");
  const session = await startResumableUpload(token, folderId, filename, mimeType);
  const src = await fetch(sourceUrl);
  if (!src.ok || !src.body) throw new Error("source fetch failed: " + src.status);
  const headers: Record<string, string> = { "Content-Type": mimeType || "application/octet-stream" };
  if (size) headers["Content-Length"] = size;
  const put = await fetch(session, {
    method: "PUT",
    headers,
    body: src.body,
    // ストリーム送信に必要（Deno）
    ...({ duplex: "half" } as Record<string, unknown>),
  });
  if (!put.ok) throw new Error("drive put " + put.status);
  const j = await put.json().catch(() => ({}));
  if (!j.id) throw new Error("drive upload returned no id");
  return j.id as string;
}

/** 指定フォルダにレジューマブルアップロードセッションを開始し、アップロードURLを返す。 */
export async function startResumableUpload(
  token: string,
  folderId: string,
  filename: string,
  mimeType: string,
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&${DRIVE_Q}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
      },
      body: JSON.stringify({ name: filename, parents: [folderId] }),
    },
  );
  const loc = res.headers.get("location");
  if (!loc) throw new Error("resumable session failed: " + (await res.text()).slice(0, 300));
  return loc;
}
