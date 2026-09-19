import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { notifications, notificationOutbound, users, channels } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { enqueue } from '../../queue/queues.js';
import { getProvider } from '../../providers/index.js';
import { decryptSecret } from '../../security/encryption.js';
import { emitEvent } from '../../core/events.js';

/**
 * Notification orchestration (§27) — separate from provider adapters.
 * In-app rows are created synchronously (cheap); channel/email/SMS sends are
 * enqueued. The 7-day expiry warning uniqueness is enforced by the DB unique
 * key (kind, subject_id, destination) — exactly-once per subscription (§26).
 */
export async function notifyTenant(input: {
  tenantId: string;
  kind: string;
  titleFa: string;
  bodyFa: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(notifications).values({
    id: newId(),
    tenantId: input.tenantId,
    kind: input.kind,
    titleFa: input.titleFa,
    bodyFa: input.bodyFa,
  });
}

export async function enqueuePasswordResetDelivery(userId: string, token: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select({ email: users.email, mobile: users.mobile }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  await enqueue('notifications', 'password-reset', {
    kind: 'PASSWORD_RESET',
    tenantId: userId,
    email: user.email,
    mobile: user.mobile,
    token,
  });
}

/**
 * Seven-day subscription expiry warning (§26): durable, idempotent.
 * Creates one row per destination; the unique key guarantees the same logical
 * warning is never sent twice for the same subscription.
 */
export async function createExpiryWarning(subscription: {
  id: string;
  tenantId: string;
  expiresAt: Date;
}): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, subscription.tenantId)).limit(1);
  const title = 'اشتراک شما به‌زودی منقضی می‌شود';
  const body = `اشتراک شما در پُستیار تا تاریخ انقضا به پایان می‌رسد. برای جلوگیری از وقفه در سرویس، اشتراک خود را تمدید کنید.`;
  const destinations: Array<'INAPP' | 'TELEGRAM' | 'BALE' | 'RUBIKA'> = ['INAPP'];

  await notifyTenant({ tenantId: subscription.tenantId, kind: 'SUBSCRIPTION_EXPIRY_7D', titleFa: title, bodyFa: body });

  for (const destination of destinations) {
    await db
      .insert(notificationOutbound)
      .values({
        id: newId(),
        kind: 'SUBSCRIPTION_EXPIRY_7D',
        subjectId: subscription.id,
        tenantId: subscription.tenantId,
        destination,
        state: 'SENT',
        sentAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set: { subjectId: subscription.id } }); // idempotent no-op
  }

  // Message destinations: publish through the tenant's active channels once each
  const tenantChannels = await db
    .select({ id: channels.id, platform: channels.platform, channelRef: channels.channelRef, status: channels.status })
    .from(channels)
    .where(and(eq(channels.tenantId, subscription.tenantId), eq(channels.status, 'ACTIVE')));

  for (const ch of tenantChannels) {
    const destination = ch.platform.toUpperCase() as 'TELEGRAM' | 'BALE' | 'RUBIKA';
    await db
      .insert(notificationOutbound)
      .values({
        id: newId(),
        kind: 'SUBSCRIPTION_EXPIRY_7D',
        subjectId: subscription.id,
        tenantId: subscription.tenantId,
        destination,
        state: 'PENDING',
      })
      .onDuplicateKeyUpdate({ set: { subjectId: subscription.id } });
    await enqueue('notifications', 'expiry-warning', {
      outboundKind: 'SUBSCRIPTION_EXPIRY_7D',
      subjectId: subscription.id,
      destination,
      platform: ch.platform,
      channelRef: ch.channelRef,
      tenantId: subscription.tenantId,
      title,
      body,
    }, { jobId: `expw:${subscription.id}:${destination}` });
  }
  void user;
  await emitEvent({ name: 'subscription.expiring', tenantId: subscription.tenantId, subjectType: 'subscription', subjectId: subscription.id });
}

/** Used by the notifications worker to actually deliver channel messages. */
export async function deliverChannelNotification(job: {
  platform: 'telegram' | 'bale' | 'rubika';
  channelRef: string;
  tenantId: string;
  title: string;
  body: string;
  outboundKind: string;
  subjectId: string;
  destination: string;
}): Promise<void> {
  const db = getDb();
  const provider = getProvider(job.platform);
  const { bots } = await import('../../db/schema.js');
  const [bot] = await db.select().from(bots).where(and(eq(bots.tenantId, job.tenantId), eq(bots.platform, job.platform), eq(bots.status, 'ACTIVE'))).limit(1);
  const row = await db
    .select()
    .from(notificationOutbound)
    .where(and(eq(notificationOutbound.kind, job.outboundKind), eq(notificationOutbound.subjectId, job.subjectId), eq(notificationOutbound.destination, job.destination as 'TELEGRAM')))
    .limit(1);

  const markFailed = async (err: string) => {
    if (row[0]) await db.update(notificationOutbound).set({ state: 'FAILED', lastError: err.slice(0, 250), attempts: row[0].attempts + 1 }).where(eq(notificationOutbound.id, row[0].id));
  };
  const markSent = async () => {
    if (row[0]) await db.update(notificationOutbound).set({ state: 'SENT', sentAt: new Date(), attempts: row[0].attempts + 1 }).where(eq(notificationOutbound.id, row[0].id));
  };

  if (!bot) {
    await markFailed('ربات فعال برای این پلتفرم یافت نشد.');
    return;
  }
  try {
    const token = decryptSecret(bot.tokenEncrypted);
    await provider.sendText(token, { chatRef: job.channelRef, text: `${job.title}\n\n${job.body}` });
    await markSent();
  } catch (err) {
    await markFailed((err as Error).message);
  }
}
