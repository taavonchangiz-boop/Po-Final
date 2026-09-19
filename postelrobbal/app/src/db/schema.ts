/**
 * Drizzle schema — mirrors database/migrations/0001_init.sql exactly.
 * MySQL/MariaDB, money = BIGINT Rial, ids = CHAR(26) ULID.
 */
import {
  bigint,
  char,
  date,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

const ts = () => datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = mysqlTable('users', {
  id: char('id', { length: 26 }).primaryKey(),
  firstName: varchar('first_name', { length: 80 }).notNull(),
  lastName: varchar('last_name', { length: 80 }).notNull(),
  mobile: varchar('mobile', { length: 20 }).notNull(),
  email: varchar('email', { length: 190 }).notNull(),
  businessName: varchar('business_name', { length: 160 }).notNull(),
  businessType: varchar('business_type', { length: 80 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  referralCode: char('referral_code', { length: 12 }),
  role: mysqlEnum('role', ['SUPER_ADMIN', 'SUPPORT', 'USER']).notNull().default('USER'),
  status: mysqlEnum('status', ['ACTIVE', 'SUSPENDED']).notNull().default('ACTIVE'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
  lastLoginAt: datetime('last_login_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [unique('uq_users_email').on(t.email), unique('uq_users_mobile').on(t.mobile)]);

export const sessions = mysqlTable('sessions', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  csrfSecret: char('csrf_secret', { length: 64 }).notNull(),
  userAgent: varchar('user_agent', { length: 255 }),
  ip: varchar('ip', { length: 64 }),
  expiresAt: datetime('expires_at').notNull(),
  revokedAt: datetime('revoked_at'),
  createdAt: ts(),
}, (t) => [unique('uq_sessions_token').on(t.tokenHash), index('idx_sessions_user').on(t.userId)]);

export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
  createdAt: ts(),
}, (t) => [unique('uq_prt_token').on(t.tokenHash)]);

export const plans = mysqlTable('plans', {
  id: char('id', { length: 26 }).primaryKey(),
  code: varchar('code', { length: 40 }).notNull(),
  nameFa: varchar('name_fa', { length: 80 }).notNull(),
  priceRial: bigint('price_rial', { mode: 'number' }).notNull().default(0),
  periodDays: int('period_days').notNull().default(30),
  limitsJson: json('limits_json').$type<PlanLimits>().notNull(),
  featuresJson: json('features_json').$type<PlanFeatures>().notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: tinyint('is_active').notNull().default(1),
  createdAt: ts(),
}, (t) => [unique('uq_plans_code').on(t.code)]);

export interface PlanLimits {
  max_channels: number;
  max_posts: number;
  max_bots: number;
  max_schedules: number;
  ai_monthly: number;
  storage_mb: number;
}
export interface PlanFeatures {
  gold_ticker: boolean;
  auto_responder: boolean;
  woocommerce: boolean;
  api_access: boolean;
}

export const subscriptions = mysqlTable('subscriptions', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  planId: char('plan_id', { length: 26 }).notNull(),
  state: mysqlEnum('state', ['ACTIVE', 'EXPIRED', 'CANCELLED']).notNull().default('ACTIVE'),
  startedAt: datetime('started_at').notNull(),
  expiresAt: datetime('expires_at').notNull(),
  cancelledAt: datetime('cancelled_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_subs_tenant_state').on(t.tenantId, t.state),
  index('idx_subs_expiry').on(t.state, t.expiresAt),
]);

export const channelRegistry = mysqlTable('channel_registry', {
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  channelRef: varchar('channel_ref', { length: 190 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }),
  claimedAt: datetime('claimed_at'),
  releasedAt: datetime('released_at'),
}, (t) => [primaryKey({ columns: [t.platform, t.channelRef] })]);

export const channels = mysqlTable('channels', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  channelRef: varchar('channel_ref', { length: 190 }).notNull(),
  title: varchar('title', { length: 190 }).notNull(),
  type: varchar('type', { length: 40 }).notNull().default('channel'),
  mode: mysqlEnum('mode', ['bot_admin', 'bot_post']).notNull().default('bot_post'),
  botId: char('bot_id', { length: 26 }),
  status: mysqlEnum('status', ['PENDING_VERIFY', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING_VERIFY'),
  healthJson: json('health_json').$type<Record<string, unknown>>(),
  lastVerifiedAt: datetime('last_verified_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_channels_tenant_ref').on(t.tenantId, t.platform, t.channelRef),
  index('idx_channels_tenant').on(t.tenantId),
]);

export const bots = mysqlTable('bots', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  tokenEncrypted: text('token_encrypted').notNull(),
  tokenMasked: varchar('token_masked', { length: 64 }).notNull(),
  username: varchar('username', { length: 190 }),
  title: varchar('title', { length: 190 }).notNull(),
  status: mysqlEnum('status', ['PENDING_VERIFY', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING_VERIFY'),
  mode: mysqlEnum('mode', ['WEBHOOK', 'POLLING']).notNull().default('POLLING'),
  webhookSecret: char('webhook_secret', { length: 64 }),
  webhookUrl: varchar('webhook_url', { length: 255 }),
  webhookRegisteredAt: datetime('webhook_registered_at'),
  healthJson: json('health_json').$type<Record<string, unknown>>(),
  aiEnabled: tinyint('ai_enabled').notNull().default(0),
  aiSystemPrompt: text('ai_system_prompt'),
  lastEventAt: datetime('last_event_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_bots_tenant').on(t.tenantId)]);

export const botUsers = mysqlTable('bot_users', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  platformUserId: varchar('platform_user_id', { length: 190 }).notNull(),
  username: varchar('username', { length: 190 }),
  displayName: varchar('display_name', { length: 190 }),
  firstSeenAt: datetime('first_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: datetime('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  stateJson: json('state_json').$type<Record<string, unknown>>(),
}, (t) => [unique('uq_bot_users').on(t.botId, t.platformUserId)]);

export const botCommands = mysqlTable('bot_commands', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  command: varchar('command', { length: 64 }).notNull(),
  descriptionFa: varchar('description_fa', { length: 190 }).notNull().default(''),
  responseKind: mysqlEnum('response_kind', ['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).notNull().default('TEXT'),
  responsePayload: json('response_payload').$type<Record<string, unknown>>(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  createdAt: ts(),
}, (t) => [unique('uq_bot_commands').on(t.botId, t.command)]);

export const botKeywords = mysqlTable('bot_keywords', {
  id: char('id', { length: 26 }).primaryKey(),
  botId: char('bot_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  keyword: varchar('keyword', { length: 190 }).notNull(),
  matchKind: mysqlEnum('match_kind', ['EXACT', 'CONTAINS']).notNull().default('CONTAINS'),
  responseKind: mysqlEnum('response_kind', ['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).notNull().default('TEXT'),
  responsePayload: json('response_payload').$type<Record<string, unknown>>(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  createdAt: ts(),
}, (t) => [index('idx_bot_keywords_bot').on(t.botId)]);

export const workflows = mysqlTable('workflows', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  nameFa: varchar('name_fa', { length: 190 }).notNull(),
  definitionJson: json('definition_json').$type<unknown>().notNull(),
  isEnabled: tinyint('is_enabled').notNull().default(1),
  runCount: int('run_count').notNull().default(0),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_workflows_tenant').on(t.tenantId)]);

export const workflowRuns = mysqlTable('workflow_runs', {
  id: char('id', { length: 26 }).primaryKey(),
  workflowId: char('workflow_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  triggerKind: varchar('trigger_kind', { length: 40 }).notNull(),
  triggerRef: varchar('trigger_ref', { length: 190 }),
  status: mysqlEnum('status', ['RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'ABORTED']).notNull().default('RUNNING'),
  stepsExecuted: int('steps_executed').notNull().default(0),
  logJson: json('log_json').$type<unknown>(),
  errorCode: varchar('error_code', { length: 80 }),
  startedAt: ts(),
  finishedAt: datetime('finished_at'),
}, (t) => [index('idx_wfruns_workflow').on(t.workflowId, t.startedAt)]);

export const botEvents = mysqlTable('bot_events', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  botId: char('bot_id', { length: 26 }).notNull(),
  platform: mysqlEnum('platform', ['telegram', 'bale', 'rubika']).notNull(),
  externalId: varchar('external_id', { length: 190 }),
  dedupHash: char('dedup_hash', { length: 64 }).notNull(),
  kind: varchar('kind', { length: 40 }).notNull(),
  chatRef: varchar('chat_ref', { length: 190 }),
  senderRef: varchar('sender_ref', { length: 190 }),
  payloadJson: json('payload_json').$type<unknown>().notNull(),
  state: mysqlEnum('state', ['PENDING', 'PROCESSED', 'FAILED']).notNull().default('PENDING'),
  createdAt: ts(),
  processedAt: datetime('processed_at'),
}, (t) => [
  unique('uq_bot_events_dedup').on(t.botId, t.dedupHash),
  index('idx_bot_events_tenant_state').on(t.tenantId, t.state),
]);

export const media = mysqlTable('media', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: int('width'),
  height: int('height'),
  checksum: char('checksum', { length: 64 }).notNull(),
  storagePath: varchar('storage_path', { length: 255 }).notNull(),
  createdAt: ts(),
}, (t) => [index('idx_media_tenant').on(t.tenantId)]);

export const posts = mysqlTable('posts', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  title: varchar('title', { length: 190 }),
  body: text('body').notNull(),
  parseMode: mysqlEnum('parse_mode', ['NONE', 'HTML', 'MARKDOWN']).notNull().default('NONE'),
  mediaId: char('media_id', { length: 26 }),
  buttonsJson: json('buttons_json').$type<PostButtons>(),
  source: mysqlEnum('source', ['MANUAL', 'GOLD', 'WORDPRESS', 'WORKFLOW']).notNull().default('MANUAL'),
  state: mysqlEnum('state', ['DRAFT', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED']).notNull().default('DRAFT'),
  scheduledAt: datetime('scheduled_at'),
  publishedAt: datetime('published_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_posts_tenant_state').on(t.tenantId, t.state),
  index('idx_posts_schedule').on(t.state, t.scheduledAt),
]);

export interface PostButtons {
  inline?: Array<{ label: string; url?: string; callback?: string }>;
  links?: Array<{ label: string; url: string }>;
}

export const postTargets = mysqlTable('post_targets', {
  id: char('id', { length: 26 }).primaryKey(),
  postId: char('post_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  channelId: char('channel_id', { length: 26 }).notNull(),
  state: mysqlEnum('state', ['PENDING', 'PROCESSING', 'SENT', 'RETRYING', 'FAILED', 'CANCELLED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  nextRetryAt: datetime('next_retry_at'),
  providerMessageId: varchar('provider_message_id', { length: 190 }),
  errorCode: varchar('error_code', { length: 80 }),
  errorMessage: varchar('error_message', { length: 255 }),
  sentAt: datetime('sent_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_post_targets').on(t.postId, t.channelId),
  index('idx_pt_tenant_state').on(t.tenantId, t.state),
  index('idx_pt_retry').on(t.state, t.nextRetryAt),
]);

export const outboxEvents = mysqlTable('outbox_events', {
  id: char('id', { length: 26 }).primaryKey(),
  aggregateType: varchar('aggregate_type', { length: 60 }).notNull(),
  aggregateId: char('aggregate_id', { length: 26 }).notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  payloadJson: json('payload_json').$type<Record<string, unknown>>().notNull(),
  state: mysqlEnum('state', ['PENDING', 'DISPATCHED', 'FAILED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  createdAt: ts(),
  dispatchedAt: datetime('dispatched_at'),
}, (t) => [index('idx_outbox_pending').on(t.state, t.createdAt)]);

export const idempotencyKeys = mysqlTable('idempotency_keys', {
  scope: varchar('scope', { length: 80 }).notNull(),
  idemKey: varchar('idem_key', { length: 190 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }),
  state: mysqlEnum('state', ['IN_PROGRESS', 'COMPLETED', 'FAILED']).notNull().default('IN_PROGRESS'),
  resultJson: json('result_json').$type<unknown>(),
  createdAt: ts(),
  expiresAt: datetime('expires_at').notNull(),
}, (t) => [primaryKey({ columns: [t.scope, t.idemKey] })]);

export const aiJobs = mysqlTable('ai_jobs', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  purpose: mysqlEnum('purpose', ['CAPTION', 'AUTO_REPLY', 'CUSTOM']).notNull().default('CUSTOM'),
  provider: varchar('provider', { length: 40 }).notNull(),
  model: varchar('model', { length: 80 }),
  inputText: text('input_text').notNull(),
  outputText: text('output_text'),
  status: mysqlEnum('status', ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).notNull().default('QUEUED'),
  promptTokens: int('prompt_tokens'),
  completionTokens: int('completion_tokens'),
  errorCode: varchar('error_code', { length: 80 }),
  createdAt: ts(),
  finishedAt: datetime('finished_at'),
}, (t) => [index('idx_ai_tenant').on(t.tenantId, t.status)]);

export const aiUsageMonthly = mysqlTable('ai_usage_monthly', {
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  periodYm: char('period_ym', { length: 7 }).notNull(),
  requestCount: int('request_count').notNull().default(0),
  tokenCount: bigint('token_count', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.periodYm] })]);

export const wordpressSites = mysqlTable('wordpress_sites', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  siteUrl: varchar('site_url', { length: 255 }).notNull(),
  siteKey: char('site_key', { length: 32 }).notNull(),
  secretHash: char('secret_hash', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['PENDING', 'ACTIVE', 'DISABLED', 'ERROR']).notNull().default('PENDING'),
  autoPublish: tinyint('auto_publish').notNull().default(1),
  categoryMapJson: json('category_map_json').$type<Record<string, string>>(),
  lastSyncAt: datetime('last_sync_at'),
  lastError: varchar('last_error', { length: 255 }),
  createdAt: ts(),
}, (t) => [unique('uq_wp_key').on(t.siteKey), unique('uq_wp_tenant_url').on(t.tenantId, t.siteUrl)]);

export const wordpressProducts = mysqlTable('wordpress_products', {
  id: char('id', { length: 26 }).primaryKey(),
  siteId: char('site_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  wcProductId: bigint('wc_product_id', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  priceRial: bigint('price_rial', { mode: 'number' }),
  permalink: varchar('permalink', { length: 255 }),
  imageUrl: varchar('image_url', { length: 512 }),
  contentHash: char('content_hash', { length: 64 }),
  lastSyncedAt: datetime('last_synced_at'),
  lastPublishedAt: datetime('last_published_at'),
}, (t) => [unique('uq_wpprod').on(t.siteId, t.wcProductId)]);

export const goldConfigs = mysqlTable('gold_configs', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  sourceUrl: varchar('source_url', { length: 512 }).notNull(),
  templateText: text('template_text').notNull(),
  channelIds: json('channel_ids').$type<string[]>().notNull(),
  frequencyMinutes: int('frequency_minutes').notNull().default(60),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Tehran'),
  changeOnly: tinyint('change_only').notNull().default(1),
  isEnabled: tinyint('is_enabled').notNull().default(0),
  lastSnapshotJson: json('last_snapshot_json').$type<unknown>(),
  lastRunAt: datetime('last_run_at'),
  createdAt: ts(),
}, (t) => [unique('uq_gold_tenant').on(t.tenantId)]);

export const goldSnapshots = mysqlTable('gold_snapshots', {
  id: char('id', { length: 26 }).primaryKey(),
  configId: char('config_id', { length: 26 }).notNull(),
  pricesJson: json('prices_json').$type<unknown>().notNull(),
  contentHash: char('content_hash', { length: 64 }).notNull(),
  // NOTE: this table's timestamp column is `captured_at` (not `created_at`),
  // so it must NOT use the shared ts() helper which hardcodes 'created_at'.
  capturedAt: datetime('captured_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  published: tinyint('published').notNull().default(0),
}, (t) => [index('idx_gold_snap').on(t.configId, t.capturedAt)]);

export const payments = mysqlTable('payments', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  purpose: mysqlEnum('purpose', ['SUBSCRIPTION', 'WALLET_TOPUP']).notNull().default('SUBSCRIPTION'),
  planId: char('plan_id', { length: 26 }),
  months: int('months').notNull().default(1),
  amountRial: bigint('amount_rial', { mode: 'number' }).notNull(),
  gateway: varchar('gateway', { length: 40 }).notNull(),
  gatewayRef: varchar('gateway_ref', { length: 190 }),
  authority: varchar('authority', { length: 190 }),
  reference: char('reference', { length: 26 }),
  state: mysqlEnum('state', ['CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PENDING_REVIEW', 'REJECTED', 'COMPLETED']).notNull().default('CREATED'),
  verifiedAt: datetime('verified_at'),
  metaJson: json('meta_json').$type<Record<string, unknown>>(),
  receiptMediaId: char('receipt_media_id', { length: 26 }),
  receiptNote: varchar('receipt_note', { length: 500 }),
  reviewedBy: char('reviewed_by', { length: 26 }),
  reviewedAt: datetime('reviewed_at'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_payments_authority').on(t.gateway, t.authority),
  unique('uq_payments_reference').on(t.reference),
  index('idx_payments_tenant').on(t.tenantId, t.state),
  index('idx_payments_state_created').on(t.state, t.createdAt),
]);

export const walletAccounts = mysqlTable('wallet_accounts', {
  tenantId: char('tenant_id', { length: 26 }).primaryKey(),
  balanceRial: bigint('balance_rial', { mode: 'number' }).notNull().default(0),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const walletLedger = mysqlTable('wallet_ledger', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  entryKind: mysqlEnum('entry_kind', ['CREDIT', 'DEBIT', 'REFUND', 'BONUS', 'PAYMENT', 'ADJUSTMENT']).notNull(),
  amountRial: bigint('amount_rial', { mode: 'number' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  refType: varchar('ref_type', { length: 60 }),
  refId: char('ref_id', { length: 26 }),
  memoFa: varchar('memo_fa', { length: 255 }).notNull().default(''),
  createdAt: ts(),
}, (t) => [
  index('idx_ledger_tenant').on(t.tenantId, t.createdAt),
  unique('uq_ledger_ref').on(t.refType, t.refId, t.entryKind),
]);

export const pointLedger = mysqlTable('point_ledger', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  entryKind: mysqlEnum('entry_kind', ['EARN', 'SPEND', 'ADJUSTMENT']).notNull(),
  amount: int('amount').notNull(),
  balanceAfter: int('balance_after').notNull(),
  refType: varchar('ref_type', { length: 60 }),
  refId: char('ref_id', { length: 26 }),
  memoFa: varchar('memo_fa', { length: 255 }).notNull().default(''),
  createdAt: ts(),
}, (t) => [index('idx_point_tenant').on(t.tenantId, t.createdAt)]);

export const referrals = mysqlTable('referrals', {
  id: char('id', { length: 26 }).primaryKey(),
  referrerTenantId: char('referrer_tenant_id', { length: 26 }).notNull(),
  referredTenantId: char('referred_tenant_id', { length: 26 }).notNull(),
  referralCode: varchar('referral_code', { length: 32 }).notNull(),
  state: mysqlEnum('state', ['REGISTERED', 'REWARDED', 'FAILED']).notNull().default('REGISTERED'),
  createdAt: ts(),
}, (t) => [unique('uq_referrals_referred').on(t.referredTenantId)]);

export const referralRewards = mysqlTable('referral_rewards', {
  id: char('id', { length: 26 }).primaryKey(),
  referralId: char('referral_id', { length: 26 }).notNull(),
  rewardKind: mysqlEnum('reward_kind', ['REGISTER', 'FIRST_PURCHASE']).notNull(),
  amount: int('amount').notNull(),
  ledgerRef: char('ledger_ref', { length: 26 }),
  createdAt: ts(),
}, (t) => [unique('uq_referral_rewards').on(t.referralId, t.rewardKind)]);

export const notifications = mysqlTable('notifications', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  kind: varchar('kind', { length: 80 }).notNull(),
  titleFa: varchar('title_fa', { length: 190 }).notNull(),
  bodyFa: text('body_fa').notNull(),
  readAt: datetime('read_at'),
  createdAt: ts(),
}, (t) => [index('idx_notif_tenant').on(t.tenantId, t.createdAt)]);

export const notificationOutbound = mysqlTable('notification_outbound', {
  id: char('id', { length: 26 }).primaryKey(),
  kind: varchar('kind', { length: 80 }).notNull(),
  subjectId: char('subject_id', { length: 26 }).notNull(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  destination: mysqlEnum('destination', ['INAPP', 'TELEGRAM', 'BALE', 'RUBIKA', 'EMAIL', 'SMS']).notNull(),
  state: mysqlEnum('state', ['PENDING', 'SENT', 'FAILED', 'SKIPPED']).notNull().default('PENDING'),
  attempts: int('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 255 }),
  createdAt: ts(),
  sentAt: datetime('sent_at'),
}, (t) => [
  unique('uq_notif_outbound').on(t.kind, t.subjectId, t.destination),
  index('idx_notif_out_state').on(t.state, t.createdAt),
]);

export const events = mysqlTable('events', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }),
  name: varchar('name', { length: 80 }).notNull(),
  subjectType: varchar('subject_type', { length: 60 }),
  subjectId: char('subject_id', { length: 26 }),
  propsJson: json('props_json').$type<Record<string, unknown>>(),
  createdAt: ts(),
}, (t) => [
  index('idx_events_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_events_name').on(t.name, t.createdAt),
]);

export const eventDaily = mysqlTable('event_daily', {
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  day: date('day').notNull(),
  eventName: varchar('event_name', { length: 80 }).notNull(),
  eventCount: int('event_count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.day, t.eventName] })]);

export const mediaAccessTokens = mysqlTable('media_access_tokens', {
  id: char('id', { length: 26 }).primaryKey(),
  mediaId: char('media_id', { length: 26 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  createdAt: ts(),
}, (t) => [unique('uq_mat_token').on(t.tokenHash)]);

export const auditLogs = mysqlTable('audit_logs', {
  id: char('id', { length: 26 }).primaryKey(),
  actorId: char('actor_id', { length: 26 }),
  actorRole: varchar('actor_role', { length: 40 }),
  action: varchar('action', { length: 80 }).notNull(),
  subjectType: varchar('subject_type', { length: 60 }),
  subjectId: char('subject_id', { length: 26 }),
  ip: varchar('ip', { length: 64 }),
  metaJson: json('meta_json').$type<Record<string, unknown>>(),
  createdAt: ts(),
}, (t) => [index('idx_audit_actor').on(t.actorId, t.createdAt)]);

export const tickets = mysqlTable('tickets', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  subject: varchar('subject', { length: 190 }).notNull(),
  category: varchar('category', { length: 80 }).notNull().default('GENERAL'),
  state: mysqlEnum('state', ['OPEN', 'ANSWERED', 'CLOSED']).notNull().default('OPEN'),
  createdAt: ts(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
}, (t) => [index('idx_tickets_tenant').on(t.tenantId, t.state)]);

export const ticketMessages = mysqlTable('ticket_messages', {
  id: char('id', { length: 26 }).primaryKey(),
  ticketId: char('ticket_id', { length: 26 }).notNull(),
  authorId: char('author_id', { length: 26 }),
  authorRole: mysqlEnum('author_role', ['USER', 'SUPPORT', 'SUPER_ADMIN', 'SYSTEM']).notNull().default('USER'),
  body: text('body').notNull(),
  createdAt: ts(),
}, (t) => [index('idx_tmsg_ticket').on(t.ticketId, t.createdAt)]);

/** One attachment per ticket message (0003, uq_tatt_message). */
export const ticketMessageAttachments = mysqlTable('ticket_message_attachments', {
  id: char('id', { length: 26 }).primaryKey(),
  messageId: char('message_id', { length: 26 }).notNull(),
  mediaId: char('media_id', { length: 26 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  createdAt: ts(),
}, (t) => [
  unique('uq_tatt_message').on(t.messageId),
  index('idx_tatt_media').on(t.mediaId),
]);

export const systemSettings = mysqlTable('system_settings', {
  settingKey: varchar('setting_key', { length: 80 }).primaryKey(),
  valueJson: json('value_json').$type<Record<string, unknown>>().notNull(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const linkClicks = mysqlTable('link_clicks', {
  id: char('id', { length: 26 }).primaryKey(),
  tenantId: char('tenant_id', { length: 26 }).notNull(),
  postTargetId: char('post_target_id', { length: 26 }),
  linkKey: varchar('link_key', { length: 80 }).notNull(),
  visitorHash: char('visitor_hash', { length: 64 }).notNull(),
  referer: varchar('referer', { length: 255 }),
  createdAt: ts(),
}, (t) => [index('idx_clicks_tenant').on(t.tenantId, t.createdAt)]);

