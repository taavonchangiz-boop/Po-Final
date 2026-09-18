/**
 * Media service: validated, private-by-default image storage.
 *
 * Security model:
 *  - mime allowlist + magic-byte sniffing (never trust the client mime),
 *  - filename sanitized to a safe basename; the stored name is random,
 *  - files live under STORAGE_DIR/uploads/{userId}/{yyyy}/ — never under any
 *    public root; served only through authorized streaming routes,
 *  - storedPath is re-validated against the STORAGE_DIR prefix before reading
 *    (path-traversal safe),
 *  - plan storage quota enforced (sum of sizes vs storageMb).
 */
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { count, desc, eq, sql } from 'drizzle-orm';
import { planLimit, notFound, validationError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { randomToken } from '../../core/crypto.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { media } from '../../db/schema.js';
import { SubscriptionService } from '../billing/subscription.service.js';

export type MediaRow = typeof media.$inferSelect;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function sniffMagic(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Minimal header-parsing dimensions for PNG/JPEG/GIF (WebP: skipped, null). */
function detectDimensions(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        const length = buf.readUInt16BE(offset + 2);
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (
          marker !== undefined &&
          ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf))
        ) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        if (length <= 0) break;
        offset += 2 + length;
      }
    }
  } catch {
    // Header parsing is best-effort; dimensions stay null.
  }
  return { width: null, height: null };
}

function sanitizeFilename(raw: string): string {
  const base = path.basename(raw).replace(/[\u0000-\u001f\\/]+/g, '');
  const cleaned = base.replace(/[^\w.\-\u0600-\u06FF ]+/g, '_').trim();
  return (cleaned.length > 0 ? cleaned : 'file').slice(0, 200);
}

function storageRoot(): string {
  return path.resolve(env.STORAGE_DIR);
}

export const MediaService = {
  maxFileBytes: MAX_FILE_BYTES,

  async storageUsedBytes(userId: number): Promise<number> {
    const rows = await db
      .select({ total: sql<string>`coalesce(sum(${media.size}), 0)` })
      .from(media)
      .where(eq(media.userId, userId));
    return Number(rows[0]?.total ?? 0);
  },

  async save(
    userId: number,
    input: { filename: string; declaredMime: string; buffer: Buffer; visibility: 'PRIVATE' | 'PUBLIC' },
  ): Promise<MediaRow> {
    if (input.buffer.length === 0) throw validationError('فایل خالی است.');
    if (input.buffer.length > MAX_FILE_BYTES) throw validationError('حجم فایل بیش از ۱۰ مگابایت است.');

    const sniffed = sniffMagic(input.buffer);
    if (sniffed === null || !ALLOWED_MIMES.has(sniffed)) {
      throw validationError('فقط تصاویر JPEG، PNG، WebP و GIF پذیرفته می‌شوند.');
    }

    const plan = await SubscriptionService.resolvePlanForUser(userId);
    const used = await MediaService.storageUsedBytes(userId);
    if (used + input.buffer.length > plan.limits.storageMb * 1024 * 1024) {
      throw planLimit('فضای ذخیره‌سازی پلن شما پر شده است. برای فضای بیشتر پلن خود را ارتقا دهید.');
    }

    const safeName = sanitizeFilename(input.filename);
    const sniffedSub = sniffed.split('/')[1] ?? '';
    const ext = MIME_BY_EXT[sniffedSub] === sniffed ? sniffedSub : sniffed === 'image/jpeg' ? 'jpg' : sniffedSub;
    const year = String(new Date().getUTCFullYear());
    const dir = path.join(storageRoot(), 'uploads', String(userId), year);
    await mkdir(dir, { recursive: true });
    const storedName = `${randomToken(12)}.${ext}`;
    const absolutePath = path.join(dir, storedName);
    await writeFile(absolutePath, input.buffer);

    const relativePath = path.relative(storageRoot(), absolutePath);
    const dims = detectDimensions(input.buffer, sniffed);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');

    const inserted = await db
      .insert(media)
      .values({
        userId,
        originalName: safeName,
        storedPath: relativePath,
        mime: sniffed,
        size: input.buffer.length,
        width: dims.width !== null && Number.isFinite(dims.width) ? dims.width : null,
        height: dims.height !== null && Number.isFinite(dims.height) ? dims.height : null,
        sha256,
        visibility: input.visibility,
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('media_insert_failed');

    AnalyticsService.trackEvent({
      userId,
      type: 'media.uploaded',
      subjectType: 'media',
      subjectId: Number(id),
      data: { mime: sniffed, size: input.buffer.length, visibility: input.visibility },
    });

    const rows = await db.select().from(media).where(eq(media.id, Number(id))).limit(1);
    const row = rows[0];
    if (!row) throw new Error('media_missing');
    return row;
  },

  async list(userId: number, page: number, limit: number): Promise<{ items: MediaRow[]; total: number }> {
    const [items, totalRows] = await Promise.all([
      db.select().from(media).where(eq(media.userId, userId)).orderBy(desc(media.id)).limit(limit).offset((page - 1) * limit),
      db.select({ value: count() }).from(media).where(eq(media.userId, userId)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  async getById(id: number): Promise<MediaRow | null> {
    const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** Resolve the absolute file path after validating the traversal-safe prefix. */
  resolveStoredPath(storedPath: string): string | null {
    const root = storageRoot();
    const absolute = path.resolve(root, storedPath);
    if (!absolute.startsWith(root + path.sep)) return null;
    return absolute;
  },

  async fileSize(absolutePath: string): Promise<number> {
    const info = await stat(absolutePath);
    return info.size;
  },
};
