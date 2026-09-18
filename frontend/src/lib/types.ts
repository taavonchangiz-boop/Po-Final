/**
 * Postyar frontend type model — mirrors the backend entities defined in
 * docs/contracts/api-contract.md.
 *
 * KEEP IN SYNC: when the API contract changes, update this file in the same
 * change-set. Field names intentionally mirror the server JSON (no mapping layer).
 */

/* ------------------------------ Auth / User ------------------------------ */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  businessName: string | null;
  activityType: string | null;
  role: Role;
  status: UserStatus;
  referralCode: string;
  referredByUserId: string | null;
  createdAt: string;
}

/** GET /me — current user + tenant summary. */
export interface MeResponse {
  user: User;
  tenant: {
    plan: Plan | null;
    subscription: Subscription | null;
    unreadNotifications: number;
    walletBalanceRial: number;
  };
}

/* ------------------------------ Channels ------------------------------ */

export type Provider = 'TELEGRAM' | 'BALE' | 'RUBIKA';
export type ChannelStatus = 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISABLED' | 'DISCONNECTED';

export interface Channel {
  id: string;
  provider: Provider;
  chatId: string;
  title: string;
  status: ChannelStatus;
  lastError: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
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

export interface Post {
  id: string;
  title: string | null;
  body: string;
  mediaId: string | null;
  status: PostStatus;
  channelIds: string[];
  scheduleAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export type DeliveryState = 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRYING' | 'FAILED' | 'CANCELLED';

export interface Delivery {
  id: string;
  postId: string;
  channelId: string;
  state: DeliveryState;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  retryAt: string | null;
  sentAt: string | null;
}

export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'CANCELLED';

export interface Schedule {
  id: string;
  postId: string;
  runAt: string;
  status: ScheduleStatus;
  recurrence: string | null;
  createdAt: string;
}

/* ------------------------------ Bots / workflows ------------------------------ */

export type BotStatus = 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISABLED';

export interface Bot {
  id: string;
  provider: Provider;
  title: string;
  username: string | null;
  status: BotStatus;
  aiEnabled: boolean;
  lastError: string | null;
  createdAt: string;
}

export interface WorkflowStep {
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  trigger: WorkflowStep;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  botId: string;
  name: string;
  definition: WorkflowDefinition;
  enabled: boolean;
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/* ------------------------------ AI ------------------------------ */

export type AiJobStatus = 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface AiJob {
  id: string;
  purpose: string;
  provider: string | null;
  model: string | null;
  status: AiJobStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  createdAt: string;
}

export interface AiUsage {
  usedCredits: number;
  quotaCredits: number;
  periodStart: string;
  periodEnd: string;
}

/* ------------------------------ Billing ------------------------------ */

export interface PlanLimits {
  channels: number;
  postsPerMonth: number;
  aiCredits: number;
  bots: number;
  schedules: number;
  storageMb: number;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  priceRial: number;
  limits: PlanLimits;
  isActive: boolean;
  sortOrder: number;
}

export interface Subscription {
  id: string;
  planId: string;
  plan: Plan | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startedAt: string;
  expiresAt: string | null;
}

export type PaymentPurpose = 'SUBSCRIPTION' | 'WALLET_TOPUP';
export type PaymentStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export interface Payment {
  id: string;
  purpose: PaymentPurpose;
  planId: string | null;
  amountRial: number;
  gateway: string;
  status: PaymentStatus;
  refId: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export type WalletEntryType =
  | 'CREDIT'
  | 'DEBIT'
  | 'REFUND'
  | 'BONUS'
  | 'PAYMENT'
  | 'ADJUSTMENT';

export interface WalletEntry {
  id: string;
  type: WalletEntryType;
  amountRial: number;
  balanceAfterRial: number;
  description: string | null;
  refId: string | null;
  createdAt: string;
}

export interface WalletSummary {
  balanceRial: number;
  recentEntries: WalletEntry[];
}

export interface ReferralInfo {
  code: string;
  referredCount: number;
  totalRewardRial: number;
  referrals: Array<{
    id: string;
    firstName: string;
    lastName: string;
    joinedAt: string;
    rewarded: boolean;
  }>;
}

/* --------------------- Notifications / support --------------------- */

export interface Notification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'ANSWERED' | 'CLOSED';

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorRole: Role;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/* ------------------------------ Analytics ------------------------------ */

export interface AnalyticsOverview {
  days: number;
  postsSent: number;
  successRate: number;
  botMessages: number;
  aiCreditsUsed: number;
}

export interface DailySeriesPoint {
  date: string;
  count: number;
}

export interface EventItem {
  id: string;
  type: string;
  title: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/* ------------------------------ Shared ------------------------------ */

/** Offset pagination envelope (page is 1-based). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Cursor pagination envelope (event/delivery streams). */
export interface CursorPaginated<T> {
  items: T[];
  nextCursor: string | null;
}
