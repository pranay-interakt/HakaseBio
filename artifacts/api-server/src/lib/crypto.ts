/**
 * Crypto primitives — Argon2id for passwords, sha256 for token storage,
 * crypto.randomBytes for opaque tokens. No bcrypt, no md5, no sha1.
 */
import argon2 from "argon2";
import crypto from "node:crypto";

// OWASP-recommended Argon2id params, tuned to ~50–100 ms on modern hardware.
const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 12) {
    throw new Error("Password too short — must be ≥ 12 chars");
  }
  return argon2.hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Opaque, URL-safe token. Default 48 bytes = 64 base64url chars. */
export function generateOpaqueToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** PKCE helpers for OAuth (Google, Apple). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * AES-256-GCM symmetric encryption for at-rest secrets (TOTP, OAuth refresh tokens).
 * Key is derived from COOKIE_SECRET via HKDF — separation of purpose from cookie signing.
 */
function deriveKey(label: string, secret: string): Buffer {
  const ab = crypto.hkdfSync(
    "sha256",
    Buffer.from(secret),
    Buffer.alloc(0),
    Buffer.from(label),
    32,
  );
  return Buffer.from(ab as ArrayBuffer);
}

export function encryptAtRest(plain: string, secret: string): string {
  const key = deriveKey("hakase:at-rest:v1", secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptAtRest(blob: string, secret: string): string {
  const [ivB64, tagB64, encB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Malformed ciphertext");
  const key = deriveKey("hakase:at-rest:v1", secret);
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const enc = Buffer.from(encB64, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
