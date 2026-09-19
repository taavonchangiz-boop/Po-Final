import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { bots, channelRegistry, channels } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { decryptSecret } from '../../security/encryption.js';

/**
 * Channel lifecycle (§21, §31). Tokens/credentials never leave this module:
 * the DTO carries status/health only. Anti-cheat: one global claim per
 * (platform, channel_ref) in channel_registry — a channel already claimed by
 * another tenant can never be connected twice.
 */

export interface ActorMeta {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string;
}

export interface ChannelDto {
  id: string;
  platform: Platform;
  channelRef: string;
  title: string;
  type: string;
  mode: 'bot_admin' | 'bot_post';
  botId: string | null;
  status: 'PENDING_VERIFY' | 'ACTIVE' | 'DISABLED' | 'ERROR';
  health: Record<string, unknown> | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

function toChannelDto(row: typeof channels.$inferSelect): ChannelDto {
  return {
    id: row.id,
    platform: row.platform,
    channelRef: row.channelRef,
    title: row.title,
    type: row.type,
    mode: row.mode,
    botId: row.botId,
    status: row.status,
    health: row.healthJson ?? null,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
  };
}

export async function listChannels(tenantId: string): Promise<ChannelDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(channels)
    .where(eq(channels.tenantId, tenantId))
    .orderBy(desc(channels.createdAt));
  return rows.map(toChannelDto);
}

export interface ConnectChannelInput {
  platform: Platform;
  channelRef: string;
  title: string;
  botId?: string;
}

/**
 * Connect a channel for a tenant.
 *
 * Verification model (documented contract): Postyar does not post test
 * messages and cannot read channel metadata without extra bot APIs. The
 * health signal is bot membership:
 *   - botId provided (bot is/will be admin of the channel) → ACTIVE
 *     immediately, with a best-effort getMe identity check recorded.
 *   - no botId → PENDING_VERIFY until the first successful delivery flips it
 *     to ACTIVE (delivery worker) or an explicit POST /channels/:id/verify.
 */
export async function connectChannel(
  tenantId: string,
  input: ConnectChannelInput,
  meta: ActorMeta = {}
): Promise<ChannelDto> {
  const db = getDb();
  const platform = input.platform;
  const channelRef = input.channelRef.trim();
  const title = input.title.trim();
  if (channelRef.length < 2 || channelRef.length > 190) {
    throw new AppError(ERR.VALIDATION('شناسهٔ کانال نامعتبر است.'));
  }
  if (title.length < 1 || title.length > 190) {
    throw new AppError(ERR.VALIDATION('عنوان کانال الزامی است.'));
  }

  await assertWithinLimit(tenantId, 'channels');

  // The linked bot must belong to this tenant, be on the same platform and be ACTIVE.
  let botId: string | null = null;
  if (input.botId) {
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, input.botId), eq(bots.tenantId, tenantId), eq(bots.platform, platform), eq(bots.status, 'ACTIVE')))
      .limit(1);
    if (!bot) {
      throw new AppError(ERR.VALIDATION('ربات انتخاب‌شده برای این پلتفرم معتبر یا فعال نیست.'));
    }
    botId = bot.id;
  }

  // Anti-cheat registry claim: claim (platform, channel_ref) globally.
  // IF-guard keeps an existing foreign claim intact even if the upsert races.
  const now = new Date();
  await db
    .insert(channelRegistry)
    .values({ platform, channelRef, tenantId, claimedAt: now })
    .onDuplicateKeyUpdate({
      set: {
        tenantId: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${tenantId}, ${channelRegistry.tenantId})`,
        claimedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, ${now}, ${channelRegistry.claimedAt})`,
        releasedAt: sql`IF(${channelRegistry.tenantId} IS NULL OR ${channelRegistry.tenantId} = ${tenantId}, NULL, ${channelRegistry.releasedAt})`,
      },
    });
  const [claim] = await db
    .select()
    .from(channelRegistry)
    .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)))
    .limit(1);
  if (claim && claim.tenantId && claim.tenantId !== tenantId) {
    throw new AppError(ERR.CONFLICT('این کانال قبلاً توسط کاربر دیگری ثبت شده است.'));
  }

  // Health signal: verify bot identity only (getMe) — never send spam messages.
  let health: Record<string, unknown> = { ok: botId !== null, verifiedVia: botId ? 'bot_admin' : 'pending_first_send' };
  if (botId) {
    const [botRow] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (botRow) {
      try {
        const provider = getProvider(platform);
        const identity = await provider.verifyBot(decryptSecret(botRow.tokenEncrypted));
        health = { ok: true, verifiedVia: 'get_me', botUsername: identity.username };
      } catch {
        health = { ok: true, verifiedVia: 'bot_admin', note: 'get_me_failed' };
      }
    }
  }
  const status: 'ACTIVE' | 'PENDING_VERIFY' = botId ? 'ACTIVE' : 'PENDING_VERIFY';

  await db
    .insert(channels)
    .values({
      id: newId(),
      tenantId,
      platform,
      channelRef,
      title,
      status,
      botId,
      healthJson: health,
      lastVerifiedAt: botId ? now : null,
    })
    .onDuplicateKeyUpdate({
      set: {
        title,
        botId,
        status,
        healthJson: health,
        lastVerifiedAt: botId ? now : null,
        updatedAt: now,
      },
    });
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, platform), eq(channels.channelRef, channelRef)))
    .limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());

  await emitEvent({ name: 'channel.created', tenantId, subjectType: 'channel', subjectId: row.id, props: { platform } });
  if (row.status === 'ACTIVE') {
    await emitEvent({ name: 'channel.connected', tenantId, subjectType: 'channel', subjectId: row.id, props: { platform } });
  }
  await audit({
    action: 'channel.connect',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: row.id,
    ip: meta.ip ?? undefined,
    meta: { platform },
  });
  return toChannelDto(row);
}

/**
 * Explicit verification: mark ACTIVE + healthy. The real-world health signal
 * is bot membership at connect time / first successful send — this endpoint
 * lets the user confirm the channel is live without Postyar sending a message.
 */
export async function verifyChannel(tenantId: string, channelId: string, meta: ActorMeta = {}): Promise<ChannelDto> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));
  const now = new Date();
  await db
    .update(channels)
    .set({ status: 'ACTIVE', lastVerifiedAt: now, healthJson: { ok: true, verifiedVia: 'manual' } })
    .where(eq(channels.id, channelId));
  const [updated] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!updated) throw new AppError(ERR.INTERNAL());
  await emitEvent({ name: 'channel.connected', tenantId, subjectType: 'channel', subjectId: channelId, props: { platform: row.platform } });
  await audit({
    action: 'channel.verify',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: channelId,
    ip: meta.ip ?? undefined,
  });
  return toChannelDto(updated);
}

/**
 * Disconnect: status DISABLED. The channel_registry claim is intentionally
 * KEPT (anti-cheat lock persists across reconnects); releasing a claim is an
 * explicit admin action, never automatic.
 */
export async function disconnectChannel(tenantId: string, channelId: string, meta: ActorMeta = {}): Promise<ChannelDto> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));
  if (row.status !== 'DISABLED') {
    await db.update(channels).set({ status: 'DISABLED' }).where(eq(channels.id, channelId));
    await emitEvent({ name: 'channel.disconnected', tenantId, subjectType: 'channel', subjectId: channelId, props: { platform: row.platform } });
    await audit({
      action: 'channel.disconnect',
      actorId: meta.actorId ?? null,
      actorRole: meta.actorRole ?? null,
      subjectType: 'channel',
      subjectId: channelId,
      ip: meta.ip ?? undefined,
    });
  }
  return { ...toChannelDto(row), status: 'DISABLED' };
}

export async function updateChannel(
  tenantId: string,
  channelId: string,
  input: { title: string },
  meta: ActorMeta = {}
): Promise<ChannelDto> {
  const db = getDb();
  const title = input.title.trim();
  if (title.length < 1 || title.length > 190) {
    throw new AppError(ERR.VALIDATION('عنوان کانال نامعتبر است.'));
  }
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال'));
  await db.update(channels).set({ title }).where(eq(channels.id, channelId));
  await emitEvent({ name: 'channel.updated', tenantId, subjectType: 'channel', subjectId: channelId });
  await audit({
    action: 'channel.update',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'channel',
    subjectId: channelId,
    ip: meta.ip ?? undefined,
  });
  return { ...toChannelDto(row), title };
}
