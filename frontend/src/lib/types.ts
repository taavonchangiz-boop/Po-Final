/**
 * Postyar frontend type model — TYPE-ONLY (no runtime code).
 *
 * Mirrors the REAL backend API as implemented in the app service layer
 * (`app/src/modules/*` — the `serialize*` functions, route zod schemas and
 * `db/schema.ts` enums), which is the source of truth for
 * docs/contracts/api-contract.md.
 *
 * SYNC: 2026-09-19 — audited field-by-field against:
 *   channels.service/routes, publishing.service/routes, bots.service/routes,
 *   workflows.service/routes, ai.service/routes, wordpress.service/routes,
 *   gold.service/routes, billing.{billing,payment,wallet,referral,subscription}.services,
 *   notifications.service/routes, support.service/routes, analytics.service/routes,
 *   media.routes, users.routes, auth.service (getMeSummary), admin.service/routes.
 *
 * Conventions (binding):
 *  - Every id is a NUMBER (MySQL bigint, drizzle mode:'number').
 *  - Timestamps arrive as ISO-8601 UTC strings (JSON serialization of Date).
 *  - Money is integer Rial, field names as sent by the server (`amount`,
 *    `priceMonthly`, `price`, … — never `*Rial` suffixes).
 *  - Enum values are technical strings; Persian labels live in the UI layer.
 *
 * NOTE: this file intentionally overrides the older draft that mirrored
 * docs/contracts/api-contract.md only. Where the contract and the backend
 * disagreed, the BACKEND shape won (e.g. delivery `nextAttemptAt` not
 * `retryAt`, bot `isEnabled`/`webhookState`/`commands`/`aiConfig`, workflow
 * `isActive`+`runCount`, ai usage `{used,quota,month}`, payment `amount`,
 * wallet `balanceAfter`, ticket status PENDING_USER, plan `code` FREE|BASIC|
 * PRO|BUSINESS|ORG, subscription status PENDING_PAYMENT, ids as numbers).
 */

/* ------------------------------ Shared ------------------------------ */

/** ISO-8601 UTC timestamp string as produced by JSON-serializing a server Date. */
export type IsoDateTime = string;

/** Error body of `{ success: false, error: … }` (core/envelope.ts ErrorBody). */
export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
  /** Zod VALIDATION_ERROR per-field Persian messages (400s only). */
  fields?: Record<string, string>;
  /** DEV only — AppError details are stripped outside development. */
  details?: unknown;
}

/** Offset pagination envelope (page is 1-based; server default limit 20, max 100). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Cursor pagination envelope (activity timeline; cursor = last event id). */
export interface CursorList<T> {
  items: T[];
  nextCursor: number | null;
}

/* ------------------------------ Auth / User ------------------------------ */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

/** GET /me user subset (auth.service getMeSummary — no `status`, no `lastLoginAt`). */
export interface User {
  id: number;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string | null;
  businessName: string | null;
  businessType: string | null;
  role: Role;
  referralCode: string | null;
  createdAt: IsoDateTime;
}

/** GET /profile row (users.routes — adds `status`; email/mobile display-only). */
export interface Profile {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string;
  businessName: string | null;
  businessType: string | null;
  role: Role;
  status: UserStatus;
  referralCode: string | null;
  createdAt: IsoDateTime;
}

/** GET /profile PATCH response subset (no status/referralCode/createdAt). */
export interface ProfileUpdated {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string;
  businessName: string | null;
  businessType: string | null;
  role: Role;
}

/** Active plan teaser embedded in GET /me. */
export interface MePlanSummary {
  code: PlanCode;
  name: string;
  expiresAt: IsoDateTime;
}

/** GET /me — current user + tenant summary. */
export interface MeResponse {
  user: User;
  plan: MePlanSummary | null;
  unreadNotifications: number;
}

/* ------------------------------ Channels ------------------------------ */

export type Provider = 'TELEGRAM' | 'BALE' | 'RUBIKA';
/** channels.kind — mysqlEnum default 'CHANNEL'. */
export type ChannelKind = 'CHANNEL' | 'GROUP' | 'BOT_CHAT';
/** NO 'DISABLED' — disable maps to DISCONNECTED (channels.service). */
export type ChannelStatus = 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISCONNECTED';

/** List/detail channel row (channels.service listChannels/getChannel). Token material never leaves the server — only `hasToken`. */
export interface Channel {
  id: number;
  provider: Provider;
  kind: ChannelKind;
  chatId: string;
  title: string;
  username: string | null;
  status: ChannelStatus;
  lastError: string | null;
  lastVerifiedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  hasToken: boolean;
}

/** POST /channels request — the token field is `token` (NOT botToken). */
export interface CreateChannelRequest {
  provider: Provider;
  chatId: string;
  title: string;
  token: string;
}

/** POST /channels response (channels.routes). */
export interface ChannelCreateResponse {
  id: number;
  provider: Provider;
  chatId: string;
  title: string;
  status: ChannelStatus;
  hasToken: boolean;
  message: string;
}

/** POST /channels/:id/verify response — the two branches are disjoint. */
export interface ChannelVerifyResponse {
  status: 'ACTIVE' | 'ERROR';
  username?: string | null;
  title?: string | null;
  error?: string | null;
}

/* --------------------------- Posts / deliveries --------------------------- */

export type PostStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

/** Full posts row (listPosts selects *; NO channelIds — targets live in deliveries, NO scheduleAt — the schedule row owns timing). */
export interface Post {
  id: number;
  userId: number;
  title: string | null;
  body: string;
  mediaId: number | null;
  status: PostStatus;
  publishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /posts 201 response — `deliveries` is a COUNT, not an array. */
export interface CreatePostResponse {
  postId: number;
  status: PostStatus;
  deliveries: number;
  scheduled: boolean;
}

/** PATCH /posts/:id response. */
export interface PostUpdateResponse {
  id: number;
  status: PostStatus;
  message: string;
}

/** POST /posts/:id/publish-now response. */
export interface PublishNowResponse {
  postId: number;
  enqueued: number;
}

export type DeliveryState = 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRYING' | 'FAILED' | 'CANCELLED';

/** GET /deliveries row (listDeliveries). Retry timing is `nextAttemptAt` (NOT `retryAt`). */
export interface Delivery {
  id: number;
  postId: number;
  channelId: number;
  state: DeliveryState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: IsoDateTime | null;
  lastError: string | null;
  errorClass: string | null;
  providerMessageId: string | null;
  sentAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** Per-channel delivery row inside GET /posts/:id (getPostDetail — joined channel). */
export interface PostDetailDelivery {
  id: number;
  state: DeliveryState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: IsoDateTime | null;
  lastError: string | null;
  errorClass: string | null;
  providerMessageId: string | null;
  sentAt: IsoDateTime | null;
  channel: {
    id: number;
    provider: Provider;
    title: string;
    chatId: string;
  };
}

/** GET /posts/:id response. */
export interface PostDetail {
  post: Post;
  deliveries: PostDetailDelivery[];
}

/** POST /deliveries/:id/retry response. */
export interface RetryDeliveryResponse {
  deliveryId: number;
  state: DeliveryState;
}

export type Recurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'CANCELLED';

/** GET /schedules row (listSchedules — joined post title). */
export interface Schedule {
  id: number;
  postId: number;
  postTitle: string | null;
  runAt: IsoDateTime;
  recurrence: Recurrence;
  timezone: string;
  status: ScheduleStatus;
  lastRunAt: IsoDateTime | null;
  nextRunAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** PATCH /schedules/:id response (updateSchedule). */
export interface ScheduleMutationResponse {
  id: number;
  postId: number;
  runAt: IsoDateTime;
  recurrence: Recurrence;
  status: ScheduleStatus;
  nextRunAt: IsoDateTime | null;
}

/* ------------------------------ Bots ------------------------------ */

/** bots.status — DISABLED exists for bots (unlike channels). */
export type BotStatus = 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISABLED';
export type WebhookState = 'UNREGISTERED' | 'REGISTERED' | 'POLLING' | 'FAILED';

export interface BotCommand {
  command: string;
  description: string;
  response: string;
}

/** bots.aiConfig JSON column (nullable — null until the user enables AI). */
export interface BotAiConfig {
  enabled: boolean;
  provider: string;
  model?: string;
  systemPrompt?: string;
  maxCreditsPerReply?: number;
}

/** serializeBot (bots.service) — isEnabled/webhookState/commands/aiConfig; NO `aiEnabled`. */
export interface Bot {
  id: number;
  provider: Provider;
  username: string | null;
  title: string | null;
  isEnabled: boolean;
  status: BotStatus;
  webhookState: WebhookState;
  commands: BotCommand[];
  aiConfig: BotAiConfig | null;
  lastError: string | null;
  lastVerifiedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /bots 201 — wraps the serialized bot + verification result. */
export interface BotCreateResponse {
  bot: Bot;
  verified: boolean;
}

/** GET/PATCH /bots/:id, POST :id/verify|enable|disable — `{ bot }` envelope. */
export interface BotResponse {
  bot: Bot;
}

/** GET /bots/:id/events row (privacy-sanitized payload). */
export interface BotEventItem {
  id: number;
  type: string;
  chatId: string | null;
  senderRef: string | null;
  payload: Record<string, unknown>;
  processedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** GET /bots/:id/users row (privacy-minimal). */
export interface BotUserItem {
  id: number;
  displayName: string | null;
  externalUserId: string;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
}

/* ------------------------------ Workflows ------------------------------ */

export type WorkflowTriggerType = 'COMMAND' | 'MESSAGE_KEYWORD' | 'ANY_MESSAGE' | 'NEW_MEMBER';
export type WorkflowStepType = 'SEND_MESSAGE' | 'SEND_BUTTONS' | 'AI_REPLY' | 'WAIT' | 'CONDITION';

export interface WorkflowStep {
  type: WorkflowStepType;
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  trigger: {
    type: WorkflowTriggerType;
    value?: string;
  };
  steps: WorkflowStep[];
}

/** serializeWorkflow (workflows.routes) — `isActive` (NOT `enabled`) + `runCount`. */
export interface Workflow {
  id: number;
  botId: number;
  name: string;
  definition: WorkflowDefinition;
  isActive: boolean;
  runCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type WorkflowRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';

/** GET /workflows/:id/runs row (full workflow_runs row; NO `SUCCESS` state). */
export interface WorkflowRun {
  id: number;
  workflowId: number;
  botId: number;
  userId: number;
  triggerEventId: number | null;
  status: WorkflowRunStatus;
  stepsExecuted: number;
  aiCalls: number;
  outboundCalls: number;
  error: string | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
}

/* ------------------------------ AI ------------------------------ */

export type AiPurpose = 'COPY' | 'RESPOND' | 'SUMMARY' | 'CUSTOM';
export type AiProvider = 'OPENAI' | 'GEMINI' | 'DEEPSEEK' | 'CLAUDE' | 'OPENROUTER' | 'MISTRAL' | 'CUSTOM';
/** serializeJob status — NO 'DONE' and no 'CANCELLED'. */
export type AiJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** serializeJob (ai.routes) — NO `prompt` (kept server-side in `input` JSON); adds errorClass + creditsUsed + completedAt. */
export interface AiJob {
  id: number;
  purpose: AiPurpose;
  provider: AiProvider;
  model: string | null;
  status: AiJobStatus;
  output: string | null;
  error: string | null;
  errorClass: string | null;
  creditsUsed: number;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}

/** POST /ai/jobs 202 response. */
export interface AiJobCreateResponse {
  jobId: number;
  status: AiJobStatus;
  queued: boolean;
}

/** GET /ai/usage (AiService.getUsage) — NOT {usedCredits,quotaCredits,period*}. */
export interface AiUsage {
  used: number;
  quota: number;
  /** `YYYY-MM` (UTC month). */
  month: string;
}

/* ------------------------------ WordPress ------------------------------ */

export type WpSiteStatus = 'PENDING' | 'CONNECTED' | 'REVOKED' | 'ERROR';

/** serializeSite / listSites — secretEncrypted never leaves the service; adds publicId + lastSeenAt + lastError. */
export interface WordpressSite {
  id: number;
  userId: number;
  siteUrl: string;
  siteName: string | null;
  publicId: string;
  status: WpSiteStatus;
  lastSeenAt: IsoDateTime | null;
  lastError: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /wordpress/sites 201 — `secret` is shown ONCE. */
export interface WordpressSiteCreateResponse {
  site: WordpressSite;
  secret: string;
  instructions: string;
}

/** POST /wordpress/sites/:id/rotate-secret response. */
export interface WpSecretRotateResponse {
  secret: string;
  instructions: string;
}

/** GET /wordpress/sites/:id/products row (full wpProducts row). */
export interface WpProduct {
  id: number;
  siteId: number;
  userId: number;
  externalProductId: string;
  title: string;
  price: number | null;
  stock: number | null;
  permalink: string | null;
  categories: string[];
  lastSyncedAt: IsoDateTime | null;
  lastPublishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /wordpress/sites/:id/sync 202 response. */
export interface WpSyncResponse {
  queued: boolean;
  siteId: number;
}

/* ------------------------------ Gold ------------------------------ */

export type GoldAsset = 'GOLD_18K' | 'GOLD_24K' | 'COIN_EMAMI' | 'COIN_HALF' | 'COIN_QUARTER' | 'SILVER' | 'USD' | 'EUR';
export type GoldFrequency = 'MANUAL' | 'HOURLY' | 'DAILY' | 'WEEKLY';

/** GET /gold/prices item (listLatestPrices — latest per asset, display order). */
export interface GoldPrice {
  asset: GoldAsset;
  price: number;
  source: 'MANUAL' | 'API';
  recordedAt: IsoDateTime;
}

/** POST /gold/prices 201 response. */
export interface GoldPriceRecorded extends GoldPrice {
  id: number;
}

/** GET /gold/configs item (listConfigs — joined channel title/provider). */
export interface GoldConfig {
  id: number;
  channelId: number;
  channelTitle: string;
  channelProvider: Provider;
  assets: GoldAsset[];
  frequency: GoldFrequency;
  timeOfDay: string | null;
  timezone: string;
  template: string | null;
  isEnabled: boolean;
  lastSentAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** PUT /gold/configs/:channelId response (serializeConfig — no channel join fields). */
export type GoldConfigSaved = Omit<GoldConfig, 'channelTitle' | 'channelProvider'>;

/** POST /gold/publish response. */
export interface GoldPublishResponse {
  sent: boolean;
  configId: number;
}

/* ------------------------------ Billing — plans / subscription ------------------------------ */

export type PlanCode = 'FREE' | 'BASIC' | 'PRO' | 'BUSINESS' | 'ORG';

/** plans.limits JSON (PlanLimitsSchema / db seed — exactly these 6 keys). */
export interface PlanLimits {
  channels: number;
  postsPerMonth: number;
  aiCredits: number;
  bots: number;
  schedules: number;
  storageMb: number;
}

/** GET /plans item (public; isActive rows only). Persian `name` comes from db/seed.ts. */
export interface Plan {
  id: number;
  code: PlanCode;
  name: string;
  description: string | null;
  priceMonthly: number;
  limits: PlanLimits;
  sortOrder: number;
}

/** GET /admin/plans item — full plans row. */
export interface AdminPlanRow extends Plan {
  isActive: boolean;
  createdAt: IsoDateTime;
}

/** Plan subset returned inside GET /subscription. */
export interface SubscriptionPlanSummary {
  id: number;
  code: PlanCode;
  name: string;
  priceMonthly: number;
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING_PAYMENT';

/** subscriptions row (getOverview returns the raw row or null). */
export interface Subscription {
  id: number;
  userId: number;
  planId: number;
  status: SubscriptionStatus;
  startedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  cancelledAt: IsoDateTime | null;
  paymentId: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** GET /subscription response — NO usage data (only /ai/usage exposes usage). */
export interface SubscriptionResponse {
  subscription: Subscription | null;
  plan: SubscriptionPlanSummary;
  limits: PlanLimits;
}

/** POST /subscription/change — zero-price plans apply instantly (redirectUrl null). */
export interface SubscriptionChangeResponse {
  paymentId: number | null;
  redirectUrl: string | null;
  applied: boolean;
}

/* ------------------------------ Billing — payments / wallet / referrals ------------------------------ */

export type GatewayName = 'ZARINPAL' | 'IDPAY' | 'ZIBAL' | 'MOCK';
export type PaymentPurpose = 'SUBSCRIPTION' | 'WALLET_TOPUP';
/** NO PENDING/CANCELLED/EXPIRED — gateway lifecycle is CREATED→REDIRECTED→VERIFIED|FAILED (|REFUNDED). */
export type PaymentStatus = 'CREATED' | 'REDIRECTED' | 'VERIFIED' | 'FAILED' | 'REFUNDED';

/** GET /payments row (billing.routes mapping) — the amount field is `amount`. */
export interface Payment {
  id: number;
  purpose: PaymentPurpose;
  planId: number | null;
  amount: number;
  gateway: GatewayName;
  status: PaymentStatus;
  authority: string | null;
  gatewayRef: string | null;
  verifiedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** POST /payments + POST /wallet/topup base response. */
export interface PaymentCreateResponse {
  paymentId: number;
  redirectUrl: string;
  amount: number;
  gateway: GatewayName;
}

/** POST /wallet/topup 201 — echoes the server presets [100k, 500k, 1M, 2M, 5M] Rial. */
export interface WalletTopupResponse extends PaymentCreateResponse {
  presets: number[];
}

export type WalletDirection = 'CREDIT' | 'DEBIT';
export type WalletEntryType = 'CREDIT' | 'DEBIT' | 'REFUND' | 'BONUS' | 'PAYMENT' | 'ADJUSTMENT';

/** GET /wallet entry (billing.routes mapping) — `amount`/`balanceAfter` (NOT amountRial/balanceAfterRial). */
export interface WalletEntry {
  id: number;
  direction: WalletDirection;
  type: WalletEntryType;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: IsoDateTime;
}

/** GET /wallet/entries row — full wallet_entries ledger row. */
export interface WalletLedgerEntry extends WalletEntry {
  referenceType: string | null;
  referenceId: number | null;
  idempotencyKey: string | null;
}

/** GET /wallet response (10 most recent entries). */
export interface WalletSummary {
  balance: number;
  currency: string;
  entries: WalletEntry[];
}

export type ReferralStatus = 'PENDING' | 'REWARDED' | 'REJECTED';

/** GET /referrals (ReferralService.getSummary) — privacy-masked names, no referral ids. */
export interface ReferralInfo {
  code: string | null;
  referred: Array<{
    name: string;
    status: ReferralStatus;
    rewardAmount: number | null;
    createdAt: IsoDateTime;
  }>;
  totalRewarded: number;
}

/* --------------------- Notifications / support --------------------- */

export type NotificationCategory = 'SYSTEM' | 'BILLING' | 'PUBLISHING' | 'SECURITY' | 'SUBSCRIPTION';

/** notifications row (full row is returned in lists). */
export interface Notification {
  id: number;
  userId: number;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** GET /notifications — offset envelope + global unreadCount. */
export type NotificationListResponse = Paginated<Notification> & {
  unreadCount: number;
};

/** POST /notifications/:id/read and /read-all responses. */
export interface NotificationReadResponse {
  ok: true;
  updated?: number;
}

export type SupportCategory = 'GENERAL' | 'BILLING' | 'TECHNICAL' | 'FEATURE';
/** NO 'IN_PROGRESS' — user reply flips OPEN, staff reply flips ANSWERED. */
export type TicketStatus = 'OPEN' | 'ANSWERED' | 'PENDING_USER' | 'CLOSED';

/** supportTickets row (category is the uppercased free string). */
export interface Ticket {
  id: number;
  userId: number;
  subject: string;
  category: string;
  status: TicketStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TicketMessageAttachment {
  id: number;
  originalName: string;
  mime: string;
}

/** ticketMessages row + resolved attachment metadata (getThread adds `attachment`). */
export interface TicketMessage {
  id: number;
  ticketId: number;
  senderUserId: number | null;
  isStaff: boolean;
  body: string;
  attachmentId: number | null;
  attachment: TicketMessageAttachment | null;
  createdAt: IsoDateTime;
}

/** GET /support/tickets/:id response. */
export interface TicketThread {
  ticket: Ticket;
  messages: TicketMessage[];
}

/** POST /support/tickets/:id/messages 201 response. */
export interface TicketReplyResponse {
  ticket: Ticket;
  message: TicketMessage;
}

/* ------------------------------ Media ------------------------------ */

export type MediaVisibility = 'PRIVATE' | 'PUBLIC';

/** POST /media 201 + GET /media list item. */
export interface MediaItem {
  id: number;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  visibility: MediaVisibility;
  createdAt: IsoDateTime;
}

/** GET /media/:id detail (adds the content hash). */
export interface MediaDetail extends MediaItem {
  sha256: string;
}

/* ------------------------------ Analytics ------------------------------ */

/** GET /analytics/overview (AnalyticsReadService.overview). */
export interface AnalyticsOverview {
  postsSent: number;
  deliveryFailed: number;
  /** 0..1 ratio or null when no deliveries in the window (multiply by 100 in UI). */
  successRate: number | null;
  botMessages: number;
  aiCredits: AiUsage;
  activeChannels: number;
  unreadNotifications: number;
}

/** GET /analytics/publishing → { series: [...] }. */
export interface PublishingSeriesPoint {
  /** `YYYY-MM-DD` (UTC day). */
  date: string;
  sent: number;
  failed: number;
}

export interface PublishingSeriesResponse {
  series: PublishingSeriesPoint[];
}

/** GET /analytics/channels → { items: [...] } (botReport has NO title — join client-side). */
export interface ChannelReportRow {
  channelId: number;
  title: string;
  sent: number;
  failed: number;
}

/** GET /analytics/bots → { items: [...] }. */
export interface BotReportRow {
  botId: number;
  received: number;
  sent: number;
}

/** GET /analytics/ai → { series: [...] }. */
export interface AiCreditsSeriesPoint {
  date: string;
  credits: number;
}

export interface AiSeriesResponse {
  series: AiCreditsSeriesPoint[];
}

/** GET /analytics/timeline item (events table subset; NO `title`/`meta` — UI maps type → Persian). */
export interface EventItem {
  id: number;
  type: string;
  subjectType: string | null;
  subjectId: number | null;
  data: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/* ------------------------------ Admin ------------------------------ */

/** GET /admin/stats (AdminService.platformStats) — payments value is the VERIFIED sum for the current UTC month. */
export interface AdminStats {
  users: number;
  activeSubscriptions: number;
  paymentsVerifiedMonthTotal: number;
  deliveriesSent30d: number;
  /** OPEN + PENDING_USER. */
  openTickets: number;
}

/** GET /admin/users row — explicit safe column list (passwordHash NEVER selected); `mobile`/`businessType` (NOT phone/activityType). */
export interface AdminUserRow {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string;
  businessName: string | null;
  businessType: string | null;
  role: Role;
  status: UserStatus;
  referralCode: string | null;
  lastLoginAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** PATCH /admin/users/:id response. */
export interface AdminUserMutationResponse {
  user: AdminUserRow;
}

/** GET /admin/audit-logs row (full auditLogs row — no actor name, join client-side by id). */
export interface AuditLogRow {
  id: number;
  actorUserId: number | null;
  action: string;
  subjectType: string | null;
  subjectId: number | null;
  ip: string | null;
  userAgent: string | null;
  data: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/** GET /admin/tickets row — same shape as the user-facing Ticket (list metadata only in wave-B UI). */
export type AdminTicketRow = Ticket;

/** GET /admin/payments row (PaymentService.listAll — full row + joined user email). */
export interface AdminPaymentRow extends Payment {
  userId: number;
  userEmail: string;
}

/** PATCH /admin/plans/:id response. */
export interface AdminPlanMutationResponse {
  plan: AdminPlanRow;
}
