/**
 * Channels service: tenant channel registry with encrypted bot tokens
 * (ADR-010), plan-limit enforcement, live provider verification.
 */
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { AnalyticsService } from '../../core/events.js';
import { decryptSecret, encryptSecret } from '../../core/crypto.js';
import { conflict, internal, notFound, planLimit, providerError } from '../../core/errors.js';
import { db } from '../../db/client.js';
import { channels, plans, subscriptions } from '../../db/schema.js';
import { getChannelProvider } from '../../providers/registry.js';
import type { ProviderKind } from '../../providers/types.js';
import { assertOwnership } from '../../security/tenant.js';
import { isDuplicateKeyError } from '../auth/auth.service.js';

export type ChannelRow = typeof channels.$inferSelect;

export interface PlanLimits {
  channels: number;
  postsPerMonth: number;
  aiCredits: number;
  bots: number;
  schedules: number;
  storageMb: number;
}

const FREE_FALLBACK_LIMITS: PlanLimits = {
  channels: 2,
  postsPerMonth: 30,
  aiCredits: 20,
  bots: 1,
  schedules: 5,
  storageMb: 200,
};

/** Active subscription + plan limits for a user (FREE fallback when expired). */
export async function getPlanLimitsForUser(userId: number): Promise<{ planId: number; planCode: string; limits: PlanLimits }> {
  const now = new Date();
  const rows = await db
    .select({ planId: plans.id, planCode: plans.code, limits: plans.limits })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE'), sql`${subscriptions.expiresAt} > ${now}`))
    .orderBy(sql`${subscriptions.expiresAt} desc`)
    .limit(1);

  const active = rows[0];
  if (active !== undefined) {
    return { planId: active.planId, planCode: active.planCode, limits: active.limits };
  }

  const freeRows = await db.select({ id: plans.id, code: plans.code, limits: plans.limits }).from(plans).where(eq(plans.code, 'FREE')).limit(1);
  const free = freeRows[0];
  if (free !== undefined) {
    return { planId: free.id, planCode: free.code, limits: free.limits };
  }
  // Plans not seeded (fresh dev DB) — degrade to FREE defaults instead of
  // blocking every mutation.
  return { planId: 0, planCode: 'FREE', limits: FREE_FALLBACK_LIMITS };
}

export async function countActiveChannels(userId: number): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(channels)
    .where(and(eq(channels.userId, userId), ne(channels.status, 'DISCONNECTED')));
  return Number(rows[0]?.value ?? 0);
}

export interface CreateChannelInput {
  provider: ProviderKind;
  chatId: string;
  title: string;
  token: string;
}

export async function createChannel(userId: number, input: CreateChannelInput): Promise<ChannelRow> {
  const { limits } = await getPlanLimitsForUser(userId);
  const used = await countActiveChannels(userId);
  if (used >= limits.channels) {
    throw planLimit('سقف کانال‌های پلن شما پر شده است. پلن خود را ارتقا دهید.');
  }

  try {
    const res = await db
      .insert(channels)
      .values({
        userId,
        provider: input.provider,
        chatId: input.chatId.trim(),
        title: input.title.trim(),
        credentialsEncrypted: encryptSecret(input.token),
        status: 'PENDING',
      });
    const id = Number(res[0]?.insertId ?? 0);
    if (id === 0) throw internal(new Error('channel_insert_missing_id'));
    const rows = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) throw notFound();
    AnalyticsService.trackEvent({ userId, type: 'channel.created', subjectType: 'channel', subjectId: id, data: { provider: input.provider } });
    return row;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // unique (userId, provider, chatId)
      throw conflict('این کانال قبلاً اضافه شده است.');
    }
    throw err;
  }
}

export interface ListChannelsParams {
  page: number;
  limit: number;
  provider?: ProviderKind;
  status?: 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISCONNECTED';
}

/** NEVER returns the token — only hasToken + metadata. */
export async function listChannels(userId: number, params: ListChannelsParams): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; limit: number }> {
  const conditions = [eq(channels.userId, userId)];
  if (params.provider !== undefined) conditions.push(eq(channels.provider, params.provider));
  if (params.status !== undefined) conditions.push(eq(channels.status, params.status));

  const offset = (params.page - 1) * params.limit;
  const rows = await db
    .select({
      id: channels.id,
      provider: channels.provider,
      kind: channels.kind,
      chatId: channels.chatId,
      title: channels.title,
      username: channels.username,
      status: channels.status,
      lastError: channels.lastError,
      lastVerifiedAt: channels.lastVerifiedAt,
      createdAt: channels.createdAt,
    })
    .from(channels)
    .where(and(...conditions))
    .orderBy(asc(channels.id))
    .limit(params.limit)
    .offset(offset);

  const totalRows = await db.select({ value: count() }).from(channels).where(and(...conditions));
  return {
    items: rows.map((r) => ({ ...r, hasToken: true })),
    total: Number(totalRows[0]?.value ?? 0),
    page: params.page,
    limit: params.limit,
  };
}

export async function getChannel(userId: number, channelId: number): Promise<Record<string, unknown>> {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const row = assertOwnership(rows[0], userId);
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    chatId: row.chatId,
    title: row.title,
    username: row.username,
    status: row.status,
    lastError: row.lastError,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
    hasToken: true,
  };
}

export interface UpdateChannelInput {
  title?: string;
  token?: string;
}

export async function updateChannel(userId: number, channelId: number, input: UpdateChannelInput): Promise<ChannelRow> {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const existing = assertOwnership(rows[0], userId);

  const rotating = input.token !== undefined && input.token.length > 0;
  await db
    .update(channels)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(rotating ? { credentialsEncrypted: encryptSecret(input.token as string), status: 'PENDING' as const, lastError: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId));

  AnalyticsService.trackAudit({
    actorUserId: userId,
    action: rotating ? 'channel.token_rotated' : 'channel.updated',
    subjectType: 'channel',
    subjectId: channelId,
    data: { provider: existing.provider, titleChanged: input.title !== undefined },
  });

  const fresh = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const row = fresh[0];
  if (row === undefined) throw notFound();
  return row;
}

/** Soft delete — disconnect keeping history. */
export async function disconnectChannel(userId: number, channelId: number): Promise<void> {
  const rows = await db.select({ id: channels.id, userId: channels.userId }).from(channels).where(eq(channels.id, channelId)).limit(1);
  assertOwnership(rows[0], userId);
  await db.update(channels).set({ status: 'DISCONNECTED', updatedAt: new Date() }).where(eq(channels.id, channelId));
  AnalyticsService.trackEvent({ userId, type: 'channel.disconnected', subjectType: 'channel', subjectId: channelId });
}

export async function disableChannel(userId: number, channelId: number): Promise<void> {
  const rows = await db.select({ id: channels.id, userId: channels.userId }).from(channels).where(eq(channels.id, channelId)).limit(1);
  assertOwnership(rows[0], userId);
  await db.update(channels).set({ status: 'DISCONNECTED', updatedAt: new Date() }).where(eq(channels.id, channelId));
  AnalyticsService.trackAudit({ actorUserId: userId, action: 'channel.disabled', subjectType: 'channel', subjectId: channelId });
}

/**
 * Live verification: decrypt token -> provider.getChat -> ACTIVE | ERROR.
 * Token material never leaves this function; only ok/error metadata persists.
 */
export async function verifyChannel(userId: number, channelId: number): Promise<{ status: 'ACTIVE' | 'ERROR'; username?: string; title?: string; error?: string }> {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const row = assertOwnership(rows[0], userId);

  let token: string;
  try {
    token = decryptSecret(row.credentialsEncrypted);
  } catch {
    throw providerError('توکن ذخیره‌شده این کانال قابل خواندن نیست. توکن را بروزرسانی کنید.');
  }

  const provider = getChannelProvider(row.provider, { token });
  const result = await provider.verifyChat(row.chatId);
  const now = new Date();

  if (result.ok) {
    await db
      .update(channels)
      .set({
        status: 'ACTIVE',
        lastVerifiedAt: now,
        lastError: null,
        username: result.username ?? row.username,
        ...(result.title !== undefined ? { title: result.title } : {}),
        updatedAt: now,
      })
      .where(eq(channels.id, channelId));
    AnalyticsService.trackEvent({ userId, type: 'channel.connected', subjectType: 'channel', subjectId: channelId, data: { provider: row.provider } });
    return { status: 'ACTIVE', username: result.username, title: result.title };
  }

  await db
    .update(channels)
    .set({ status: 'ERROR', lastVerifiedAt: now, lastError: result.error ?? 'خطای ناشناخته سرویس‌دهنده.', updatedAt: now })
    .where(eq(channels.id, channelId));
  AnalyticsService.trackEvent({
    userId,
    type: 'channel.failed',
    subjectType: 'channel',
    subjectId: channelId,
    data: { provider: row.provider, error: (result.error ?? '').slice(0, 200) },
  });
  return { status: 'ERROR', error: result.error };
}

/** Channels usable as delivery targets (owned + ACTIVE). */
export async function listUsableChannels(userId: number, channelIds: number[]): Promise<ChannelRow[]> {
  if (channelIds.length === 0) return [];
  const rows = await db
    .select()
    .from(channels)
    .where(and(eq(channels.userId, userId), inArray(channels.id, channelIds)));
  return rows;
}
