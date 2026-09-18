/**
 * Postyar — canonical database schema (MySQL / MariaDB, Drizzle ORM).
 *
 * CONVENTIONS (binding for all modules):
 *  - Money is always BIGINT integer Rial. Never float.
 *  - Timestamps are `timestamp` (UTC canonical). UI converts to Jalali/Tehran at the edge.
 *  - Every tenant-owned table carries user_id and every query MUST be ownership-aware.
 *  - Secrets at rest are AES-256-GCM encrypted payloads (base64 nonce|tag|ciphertext) in *_encrypted columns.
 *  - Enum values are technical; user-facing labels are translated to Persian in the UI layer.
 */
import {
  bigint,
  boolean,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/* ============================== Identity ============================== */

export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    mobile: varchar('mobile', { length: 20 }).notNull(),
    email: varchar('email', { length: 190 }).notNull(),
    businessName: varchar('business_name', { length: 190 }).notNull(),
    businessType: varchar('business_type', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: mysqlEnum('role', ['SUPER_ADMIN', 'ADMIN', 'USER']).notNull().default('USER'),
    status: mysqlEnum('status', ['ACTIVE', 'SUSPENDED']).notNull().default('ACTIVE'),
    referralCode: varchar('referral_code', { length: 16 }),
    referredBy: bigint('referred_by', { mode: 'number' }),
    acceptedTerms: boolean('accepted_terms').notNull().default(true),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_users_email').on(t.email),
    uniqueIndex('uq_users_mobile').on(t.mobile),
    uniqueIndex('uq_users_referral_code').on(t.referralCode),
    index('ix_users_role').on(t.role),
  ],
);

/** Single-row mutex for the first-user SUPER_ADMIN rule (DB-level serialization). */
export const systemBootstrap = mysqlTable('system_bootstrap', {
  id: int('id').primaryKey(),
  allocatedAt: timestamp('allocated_at').notNull().defaultNow(),
});

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: varchar('ip', { length: 45 }),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_sessions_token_hash').on(t.tokenHash),
    index('ix_sessions_user').on(t.userId),
    index('ix_sessions_expires').on(t.expiresAt),
  ],
);

export const passwordResets = mysqlTable(
  'password_resets',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_password_resets_token').on(t.tokenHash), index('ix_password_resets_user').on(t.userId)],
);

/* ============================== Billing domains ============================== */

export const plans = mysqlTable(
  'plans',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    code: mysqlEnum('code', ['FREE', 'BASIC', 'PRO', 'BUSINESS', 'ORG']).notNull(),
    name: varchar('name', { length: 100 }).notNull(), // Persian display name
    description: text('description'),
    priceMonthly: bigint('price_monthly', { mode: 'number' }).notNull().default(0),
    limits: json('limits')
      .$type<{
        channels: number;
        postsPerMonth: number;
        aiCredits: number;
        bots: number;
        schedules: number;
        storageMb: number;
      }>()
      .notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_plans_code').on(t.code)],
);

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    planId: bigint('plan_id', { mode: 'number' }).notNull(),
    status: mysqlEnum('status', ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT']).notNull().default('ACTIVE'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    cancelledAt: timestamp('cancelled_at'),
    paymentId: bigint('payment_id', { mode: 'number' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_subscriptions_user_status').on(t.userId, t.status),
    index('ix_subscriptions_expires').on(t.status, t.expiresAt),
  ],
);

export const payments = mysqlTable(
  'payments',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    purpose: mysqlEnum('purpose', ['SUBSCRIPTION', 'WALLET_TOPUP']).notNull(),
    planId: bigint('plan_id', { mode: 'number' }),
    subscriptionId: bigint('subscription_id', { mode: 'number' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    gateway: mysqlEnum('gateway', ['ZARINPAL', 'IDPAY', 'ZIBAL', 'MOCK']).notNull(),
    authority: varchar('authority', { length: 128 }),
    gatewayRef: varchar('gateway_ref', { length: 128 }),
    status: mysqlEnum('status', ['CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'REFUNDED']).notNull().default('CREATED'),
    meta: json('meta').$type<Record<string, unknown>>(),
    verifiedAt: timestamp('verified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_payments_user').on(t.userId),
    index('ix_payments_status').on(t.status),
    uniqueIndex('uq_payments_authority').on(t.authority),
  ],
);

/** Wallet: authoritative balance row + append-only ledger. Balance changes only inside transactions. */
export const wallets = mysqlTable(
  'wallets',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('IRR'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_wallets_user').on(t.userId)],
);

export const walletEntries = mysqlTable(
  'wallet_entries',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    direction: mysqlEnum('direction', ['CREDIT', 'DEBIT']).notNull(),
    type: mysqlEnum('type', ['CREDIT', 'DEBIT', 'REFUND', 'BONUS', 'PAYMENT', 'ADJUSTMENT']).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    referenceType: varchar('reference_type', { length: 40 }),
    referenceId: bigint('reference_id', { mode: 'number' }),
    description: varchar('description', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_wallet_entries_user').on(t.userId, t.id),
    uniqueIndex('uq_wallet_entries_idem').on(t.idempotencyKey),
  ],
);

export const referrals = mysqlTable(
  'referrals',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    referrerUserId: bigint('referrer_user_id', { mode: 'number' }).notNull(),
    referredUserId: bigint('referred_user_id', { mode: 'number' }).notNull(),
    code: varchar('code', { length: 16 }).notNull(),
    status: mysqlEnum('status', ['PENDING', 'REWARDED', 'REJECTED']).notNull().default('PENDING'),
    rewardAmount: bigint('reward_amount', { mode: 'number' }),
    rewardedAt: timestamp('rewarded_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_referrals_referred').on(t.referredUserId),
    index('ix_referrals_referrer').on(t.referrerUserId),
  ],
);

/* ============================== Channels ============================== */

export const channels = mysqlTable(
  'channels',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    provider: mysqlEnum('provider', ['TELEGRAM', 'BALE', 'RUBIKA']).notNull(),
    kind: mysqlEnum('kind', ['CHANNEL', 'GROUP', 'BOT_CHAT']).notNull().default('CHANNEL'),
    chatId: varchar('chat_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 190 }).notNull(),
    username: varchar('username', { length: 64 }),
    /** Encrypted bot token / credential bundle (AES-256-GCM). */
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    status: mysqlEnum('status', ['PENDING', 'ACTIVE', 'ERROR', 'DISCONNECTED']).notNull().default('PENDING'),
    lastError: text('last_error'),
    lastVerifiedAt: timestamp('last_verified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_channels_owner').on(t.userId, t.provider, t.chatId),
    index('ix_channels_user_status').on(t.userId, t.status),
  ],
);

/* ============================== Bots & workflows ============================== */

export const bots = mysqlTable(
  'bots',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    provider: mysqlEnum('provider', ['TELEGRAM', 'BALE', 'RUBIKA']).notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    username: varchar('username', { length: 64 }),
    title: varchar('title', { length: 190 }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    status: mysqlEnum('status', ['PENDING', 'ACTIVE', 'ERROR', 'DISABLED']).notNull().default('PENDING'),
    /** Random per-bot secret delivered to the provider webhook registration (header-based, never in query strings). */
    webhookSecret: varchar('webhook_secret', { length: 64 }).notNull(),
    webhookState: mysqlEnum('webhook_state', ['UNREGISTERED', 'REGISTERED', 'POLLING', 'FAILED']).notNull().default('UNREGISTERED'),
    commands: json('commands')
      .$type<Array<{ command: string; description: string; response: string }>>()
      .notNull()
      .default([]),
    aiConfig: json('ai_config').$type<{
      enabled: boolean;
      provider: string;
      model?: string;
      systemPrompt?: string;
      maxCreditsPerReply?: number;
    } | null>(),
    lastError: text('last_error'),
    lastVerifiedAt: timestamp('last_verified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ix_bots_user').on(t.userId), index('ix_bots_status').on(t.status)],
);

export const botEvents = mysqlTable(
  'bot_events',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    botId: bigint('bot_id', { mode: 'number' }).notNull(),
    provider: mysqlEnum('provider', ['TELEGRAM', 'BALE', 'RUBIKA']).notNull(),
    externalEventId: varchar('external_event_id', { length: 128 }),
    type: varchar('type', { length: 40 }).notNull(),
    chatId: varchar('chat_id', { length: 64 }),
    senderRef: varchar('sender_ref', { length: 64 }),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_bot_events_dedupe').on(t.botId, t.externalEventId),
    index('ix_bot_events_bot').on(t.botId, t.id),
  ],
);

export const botUsers = mysqlTable(
  'bot_users',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    botId: bigint('bot_id', { mode: 'number' }).notNull(),
    provider: mysqlEnum('provider', ['TELEGRAM', 'BALE', 'RUBIKA']).notNull(),
    externalUserId: varchar('external_user_id', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 190 }),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_bot_users').on(t.botId, t.externalUserId), index('ix_bot_users_bot').on(t.botId)],
);

export const workflows = mysqlTable(
  'workflows',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    botId: bigint('bot_id', { mode: 'number' }).notNull(),
    name: varchar('name', { length: 190 }).notNull(),
    definition: json('definition')
      .$type<{
        trigger: { type: 'COMMAND' | 'MESSAGE_KEYWORD' | 'ANY_MESSAGE' | 'NEW_MEMBER'; value?: string };
        steps: Array<{
          type: 'SEND_MESSAGE' | 'SEND_BUTTONS' | 'AI_REPLY' | 'WAIT' | 'CONDITION';
          config: Record<string, unknown>;
        }>;
      }>()
      .notNull(),
    isActive: boolean('is_active').notNull().default(true),
    runCount: bigint('run_count', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ix_workflows_user_bot').on(t.userId, t.botId), index('ix_workflows_active').on(t.isActive)],
);

export const workflowRuns = mysqlTable(
  'workflow_runs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    workflowId: bigint('workflow_id', { mode: 'number' }).notNull(),
    botId: bigint('bot_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    triggerEventId: bigint('trigger_event_id', { mode: 'number' }),
    status: mysqlEnum('status', ['RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED']).notNull().default('RUNNING'),
    stepsExecuted: int('steps_executed').notNull().default(0),
    aiCalls: int('ai_calls').notNull().default(0),
    outboundCalls: int('outbound_calls').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [index('ix_workflow_runs_workflow').on(t.workflowId, t.id), index('ix_workflow_runs_status').on(t.status)],
);

/* ============================== Publishing ============================== */

export const media = mysqlTable(
  'media',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    storedPath: varchar('stored_path', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: int('width'),
    height: int('height'),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    visibility: mysqlEnum('visibility', ['PRIVATE', 'PUBLIC']).notNull().default('PRIVATE'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_media_user').on(t.userId, t.id)],
);

export const posts = mysqlTable(
  'posts',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    title: varchar('title', { length: 190 }),
    body: text('body').notNull(),
    mediaId: bigint('media_id', { mode: 'number' }),
    status: mysqlEnum('status', ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ix_posts_user_status').on(t.userId, t.status), index('ix_posts_created').on(t.userId, t.id)],
);

/** Delivery = durable per-channel work item consumed by the queue worker. */
export const deliveries = mysqlTable(
  'deliveries',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    postId: bigint('post_id', { mode: 'number' }).notNull(),
    channelId: bigint('channel_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    state: mysqlEnum('state', ['PENDING', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'CANCELLED']).notNull().default('PENDING'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at'),
    lastError: text('last_error'),
    errorClass: varchar('error_class', { length: 24 }),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_deliveries_post_channel').on(t.postId, t.channelId),
    index('ix_deliveries_due').on(t.state, t.nextAttemptAt),
    index('ix_deliveries_user').on(t.userId, t.id),
  ],
);

export const schedules = mysqlTable(
  'schedules',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    postId: bigint('post_id', { mode: 'number' }).notNull(),
    runAt: timestamp('run_at').notNull(),
    recurrence: mysqlEnum('recurrence', ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY']).notNull().default('ONCE'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
    status: mysqlEnum('status', ['ACTIVE', 'PAUSED', 'DONE', 'CANCELLED']).notNull().default('ACTIVE'),
    lastRunAt: timestamp('last_run_at'),
    nextRunAt: timestamp('next_run_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ix_schedules_due').on(t.status, t.runAt), index('ix_schedules_user').on(t.userId, t.id)],
);

export const outboxEvents = mysqlTable(
  'outbox_events',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 40 }).notNull(),
    aggregateId: bigint('aggregate_id', { mode: 'number' }).notNull(),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum('status', ['PENDING', 'PROCESSING', 'DONE', 'FAILED']).notNull().default('PENDING'),
    attempts: int('attempts').notNull().default(0),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_outbox_due').on(t.status, t.availableAt), index('ix_outbox_aggregate').on(t.aggregateType, t.aggregateId)],
);

export const idempotencyKeys = mysqlTable(
  'idempotency_keys',
  {
    key: varchar('key', { length: 190 }).primaryKey(),
    scope: varchar('scope', { length: 40 }).notNull(),
    userId: bigint('user_id', { mode: 'number' }),
    response: json('response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [index('ix_idempotency_expires').on(t.expiresAt)],
);

/* ============================== AI ============================== */

export const aiJobs = mysqlTable(
  'ai_jobs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    botId: bigint('bot_id', { mode: 'number' }),
    provider: mysqlEnum('provider', ['OPENAI', 'GEMINI', 'DEEPSEEK', 'CLAUDE', 'OPENROUTER', 'MISTRAL', 'CUSTOM']).notNull(),
    model: varchar('model', { length: 80 }),
    purpose: mysqlEnum('purpose', ['COPY', 'RESPOND', 'SUMMARY', 'CUSTOM']).notNull(),
    input: json('input').$type<{ system?: string; prompt: string; maxTokens?: number; temperature?: number }>().notNull(),
    output: text('output'),
    status: mysqlEnum('status', ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']).notNull().default('QUEUED'),
    errorClass: varchar('error_class', { length: 24 }),
    error: text('error'),
    creditsUsed: int('credits_used').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => [index('ix_ai_jobs_user').on(t.userId, t.id), index('ix_ai_jobs_status').on(t.status)],
);

/** Monthly AI usage ledger for quota enforcement (atomic upsert per user/month). */
export const aiUsage = mysqlTable(
  'ai_usage',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    periodMonth: varchar('period_month', { length: 7 }).notNull(), // e.g. 2025-01
    credits: int('credits').notNull().default(0),
    requestCount: int('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_ai_usage').on(t.userId, t.periodMonth)],
);

/* ============================== WordPress connector ============================== */

export const wordpressSites = mysqlTable(
  'wordpress_sites',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    siteUrl: varchar('site_url', { length: 255 }).notNull(),
    siteName: varchar('site_name', { length: 190 }),
    /** Shared secret for HMAC-signed webhooks in both directions (encrypted at rest). */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** Public identifier used in webhook URLs (not secret). */
    publicId: varchar('public_id', { length: 32 }).notNull(),
    status: mysqlEnum('status', ['PENDING', 'CONNECTED', 'REVOKED', 'ERROR']).notNull().default('PENDING'),
    lastSeenAt: timestamp('last_seen_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_wp_sites_public_id').on(t.publicId), index('ix_wp_sites_user').on(t.userId)],
);

export const wpProducts = mysqlTable(
  'wp_products',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    siteId: bigint('site_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    externalProductId: varchar('external_product_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    price: bigint('price', { mode: 'number' }),
    stock: int('stock'),
    permalink: varchar('permalink', { length: 500 }),
    categories: json('categories').$type<string[]>().notNull().default([]),
    lastSyncedAt: timestamp('last_synced_at'),
    lastPublishedAt: timestamp('last_published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_wp_products').on(t.siteId, t.externalProductId), index('ix_wp_products_user').on(t.userId)],
);

export const wpEvents = mysqlTable(
  'wp_events',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    siteId: bigint('site_id', { mode: 'number' }).notNull(),
    type: varchar('type', { length: 60 }).notNull(),
    externalEventId: varchar('external_event_id', { length: 128 }),
    signatureValid: boolean('signature_valid').notNull().default(false),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_wp_events_dedupe').on(t.siteId, t.externalEventId),
    index('ix_wp_events_site').on(t.siteId, t.id),
  ],
);

/* ============================== Gold ============================== */

export const goldPrices = mysqlTable(
  'gold_prices',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    asset: mysqlEnum('asset', ['GOLD_18K', 'GOLD_24K', 'COIN_EMAMI', 'COIN_HALF', 'COIN_QUARTER', 'SILVER', 'USD', 'EUR']).notNull(),
    price: bigint('price', { mode: 'number' }).notNull(), // Rial
    source: mysqlEnum('source', ['MANUAL', 'API']).notNull().default('MANUAL'),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
  },
  (t) => [index('ix_gold_prices_user_asset').on(t.userId, t.asset, t.id)],
);

export const goldConfigs = mysqlTable(
  'gold_configs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    channelId: bigint('channel_id', { mode: 'number' }).notNull(),
    assets: json('assets').$type<string[]>().notNull().default([]),
    frequency: mysqlEnum('frequency', ['MANUAL', 'HOURLY', 'DAILY', 'WEEKLY']).notNull().default('MANUAL'),
    timeOfDay: varchar('time_of_day', { length: 5 }), // HH:mm local to timezone
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
    template: text('template'),
    isEnabled: boolean('is_enabled').notNull().default(false),
    lastPriceSnapshot: json('last_price_snapshot').$type<Record<string, number>>(),
    lastSentAt: timestamp('last_sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_gold_configs_user_channel').on(t.userId, t.channelId)],
);

/* ============================== Analytics, notifications, ops ============================== */

/** Append-only analytics events; cursor-paginated by id. Never store secrets or full message bodies. */
export const events = mysqlTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }),
    type: varchar('type', { length: 60 }).notNull(),
    subjectType: varchar('subject_type', { length: 40 }),
    subjectId: bigint('subject_id', { mode: 'number' }),
    data: json('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_events_user_id').on(t.userId, t.id), index('ix_events_type').on(t.type, t.id)],
);

/** Pre-aggregated daily read model refreshed by the scheduler (dashboard must not scan raw events). */
export const dailyStats = mysqlTable(
  'daily_stats',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    statDate: date('stat_date').notNull(),
    metric: varchar('metric', { length: 60 }).notNull(),
    subjectType: varchar('subject_type', { length: 40 }),
    subjectId: bigint('subject_id', { mode: 'number' }),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_daily_stats').on(t.userId, t.statDate, t.metric, t.subjectType, t.subjectId)],
);

export const notifications = mysqlTable(
  'notifications',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    category: mysqlEnum('category', ['SYSTEM', 'BILLING', 'PUBLISHING', 'SECURITY', 'SUBSCRIPTION']).notNull().default('SYSTEM'),
    title: varchar('title', { length: 190 }).notNull(),
    body: text('body').notNull(),
    data: json('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_notifications_user').on(t.userId, t.id)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    actorUserId: bigint('actor_user_id', { mode: 'number' }),
    action: varchar('action', { length: 60 }).notNull(),
    subjectType: varchar('subject_type', { length: 40 }),
    subjectId: bigint('subject_id', { mode: 'number' }),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 255 }),
    data: json('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_audit_logs_action').on(t.action, t.id), index('ix_audit_logs_actor').on(t.actorUserId, t.id)],
);

/* ============================== Support ============================== */

export const supportTickets = mysqlTable(
  'support_tickets',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    subject: varchar('subject', { length: 190 }).notNull(),
    category: varchar('category', { length: 40 }).notNull().default('GENERAL'),
    status: mysqlEnum('status', ['OPEN', 'ANSWERED', 'PENDING_USER', 'CLOSED']).notNull().default('OPEN'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ix_tickets_user').on(t.userId, t.id), index('ix_tickets_status').on(t.status, t.id)],
);

export const ticketMessages = mysqlTable(
  'ticket_messages',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull(),
    senderUserId: bigint('sender_user_id', { mode: 'number' }),
    isStaff: boolean('is_staff').notNull().default(false),
    body: text('body').notNull(),
    attachmentId: bigint('attachment_id', { mode: 'number' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ix_ticket_messages_ticket').on(t.ticketId, t.id)],
);

/* ============================== System ============================== */

export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: json('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Short link codes for click tracking (redirect target stored server-side only). */
export const linkTargets = mysqlTable(
  'link_targets',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    postId: bigint('post_id', { mode: 'number' }),
    channelId: bigint('channel_id', { mode: 'number' }),
    code: varchar('code', { length: 16 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),
    clickCount: bigint('click_count', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_link_targets_code').on(t.code), index('ix_link_targets_user').on(t.userId, t.id)],
);
