/**
 * Crypto kernel: AES-256-GCM secret encryption at rest (ADR-010),
 * hashing, random tokens and constant-time comparison.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const IV_BYTES = 12; // GCM standard nonce
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const raw = env.ENCRYPTION_KEY;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf8');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must resolve to exactly 32 bytes (32 chars or 64 hex chars)');
  }
  return buf;
}

/** Encrypt to `base64(nonce | tag | ciphertext)` (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a `base64(nonce | tag | ciphertext)` payload. Throws on tamper. */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error('Invalid encrypted payload');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Random hex token (default 32 bytes = 64 hex chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function randomId(): string {
  return randomUUID();
}

/** Constant-time string comparison (false for length mismatch without early leak). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // burn comparable time
    return false;
  }
  return timingSafeEqual(ab, bb);
}
