import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { media, mediaAccessTokens } from '../../db/schema.js';
import { newId, newToken, sha256Hex } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { loadEnv } from '../../config/env.js';

/**
 * Media storage (§60 path-traversal safe): filenames are server-generated
 * ULIDs inside a tenant subfolder; the storage root is private (never served
 * statically). Access only through short-lived hash-validated tokens.
 */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};

export function storageRoot(): string {
  const raw = process.env.STORAGE_DIR;
  return raw && raw.trim() !== ''
    ? path.resolve(raw.trim())
    : path.resolve(process.cwd(), './private/storage');
}

/** Magic-byte sniffing — declared MIME must match actual content. */
export function magicMatches(mime: string, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const hexAt = (offset: number, length: number): string =>
    buf.subarray(offset, offset + length).toString('hex');
  switch (mime) {
    case 'image/jpeg':
      return hexAt(0, 3) === 'ffd8ff';
    case 'image/png':
      return hexAt(0, 4) === '89504e47';
    case 'image/gif':
      return hexAt(0, 3) === '474946';
    case 'image/webp':
      return hexAt(0, 4) === '52494646' && hexAt(8, 4) === '57454250'; // RIFF....WEBP
    case 'video/mp4':
      return buf.toString('latin1', 4, 8) === 'ftyp'; // box type at offset 4
    default:
      return false;
  }
}

export interface MediaPublic {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksum: string;
  createdAt: Date;
}

type MediaRow = typeof media.$inferSelect;

function toPublic(row: MediaRow): MediaPublic {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    createdAt: row.createdAt,
  };
}

/** ULID chars only — the tenant folder is never user-controlled. */
function safeTenantDir(tenantId: string): string {
  if (!/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(tenantId)) {
    throw new AppError(ERR.INTERNAL());
  }
  return tenantId;
}

function safeAbsolutePath(storagePath: string): string {
  const root = storageRoot();
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep)) throw new AppError(ERR.NOT_FOUND('فایل'));
  return abs;
}

export async function uploadMedia(
  tenantId: string,
  input: { buffer: Buffer; mimeType: string }
): Promise<MediaPublic> {
  if (input.buffer.length === 0) throw new AppError(ERR.VALIDATION('فایل ارسالی خالی است.'));
  if (input.buffer.length > MAX_MEDIA_BYTES) {
    throw new AppError(ERR.VALIDATION('حجم فایل باید حداکثر ۸ مگابایت باشد.'));
  }
  const ext = MIME_EXT[input.mimeType.toLowerCase()];
  if (!ext) {
    throw new AppError(ERR.VALIDATION('نوع فایل مجاز نیست. فرمت‌های مجاز: JPG، PNG، WebP، GIF و MP4.'));
  }
  if (!magicMatches(ext === 'jpg' ? 'image/jpeg' : input.mimeType.toLowerCase(), input.buffer)) {
    throw new AppError(ERR.VALIDATION('محتوای فایل با نوع اعلام‌شده هم‌خوانی ندارد.'));
  }

  const tenantDir = safeTenantDir(tenantId);
  const filename = `${newId()}.${ext}`;
  const storagePath = `${tenantDir}/${filename}`;
  const root = storageRoot();
  await fs.mkdir(path.join(root, tenantDir), { recursive: true });
  await fs.writeFile(path.join(root, storagePath), input.buffer, { mode: 0o600 });

  const db = getDb();
  const id = newId();
  await db.insert(media).values({
    id,
    tenantId,
    filename,
    mime: input.mimeType.toLowerCase(),
    sizeBytes: input.buffer.length,
    width: null, // dimensions intentionally skipped (no extra deps)
    height: null,
    checksum: createHash('sha256').update(input.buffer).digest('hex'),
    storagePath,
  });
  await audit({ action: 'media.upload', actorId: tenantId, subjectType: 'media', subjectId: id });
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());
  return toPublic(row);
}

export async function listMedia(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: MediaPublic[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.tenantId, tenantId))
    .orderBy(desc(media.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(media)
    .where(eq(media.tenantId, tenantId));
  return { items: rows.map(toPublic), total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function getOwnedMedia(tenantId: string, mediaId: string): Promise<MediaRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('فایل'));
  return row;
}

export async function deleteMedia(tenantId: string, mediaId: string): Promise<void> {
  const row = await getOwnedMedia(tenantId, mediaId);
  await fs.unlink(safeAbsolutePath(row.storagePath)).catch(() => undefined); // ENOENT tolerated
  const db = getDb();
  await db.delete(mediaAccessTokens).where(eq(mediaAccessTokens.mediaId, mediaId));
  await db.delete(media).where(eq(media.id, mediaId));
  await audit({ action: 'media.delete', actorId: tenantId, subjectType: 'media', subjectId: mediaId });
}

/** 15-minute hash-validated access token for provider delivery (§187). */
export async function createMediaAccessToken(
  tenantId: string,
  mediaId: string
): Promise<{ url: string; expiresAt: Date }> {
  const row = await getOwnedMedia(tenantId, mediaId);
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const db = getDb();
  await db.insert(mediaAccessTokens).values({
    id: newId(),
    mediaId: row.id,
    tokenHash: await sha256Hex(token),
    expiresAt,
  });
  const url = `${loadEnv().API_URL}/api/v1/media/raw/${row.id}?token=${token}`;
  return { url, expiresAt };
}

/** Token lookup for the PUBLIC raw route: hash match + not expired. */
export async function resolveMediaByToken(mediaId: string, token: unknown): Promise<MediaRow | null> {
  if (typeof token !== 'string' || token.length < 8) return null;
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const [access] = await db
    .select({ id: mediaAccessTokens.id })
    .from(mediaAccessTokens)
    .where(
      and(
        eq(mediaAccessTokens.mediaId, mediaId),
        eq(mediaAccessTokens.tokenHash, tokenHash),
        gt(mediaAccessTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!access) return null;
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return row ?? null;
}

export function openMediaStream(row: MediaRow): ReturnType<typeof createReadStream> {
  return createReadStream(safeAbsolutePath(row.storagePath));
}
