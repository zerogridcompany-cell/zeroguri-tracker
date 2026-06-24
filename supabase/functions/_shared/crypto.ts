// _shared/crypto.ts — トークンの AES-GCM 暗号化（保存は Postgres bytea）
// 形式: bytea = IV(12 bytes) || ciphertext。DB とは `\x<hex>` 文字列でやり取りする。
import { config } from "./env.ts";

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  const b64 = config.tokenEncKey();
  if (!b64) throw new Error("TOKEN_ENC_KEY is not set (32-byte base64 required)");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must decode to 32 bytes");
  keyPromise = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return keyPromise;
}

function toHexBytea(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "\\x" + hex;
}

function fromHexBytea(value: string): Uint8Array {
  // PostgREST は bytea を `\x<hex>` で返す
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** 平文トークン → DB 保存用 bytea 文字列（`\x...`）。null/空は null を返す。 */
export async function encryptToken(plaintext: string | null | undefined): Promise<string | null> {
  if (!plaintext) return null;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return toHexBytea(packed);
}

/** DB の bytea 文字列（`\x...`）→ 平文トークン。null は null を返す。 */
export async function decryptToken(byteaHex: string | null | undefined): Promise<string | null> {
  if (!byteaHex) return null;
  const key = await getKey();
  const packed = fromHexBytea(byteaHex);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/** state（CSRF 用）のランダム生成 */
export function randomState(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) =>
    ({ "+": "-", "/": "_", "=": "" }[c]!)
  );
}
