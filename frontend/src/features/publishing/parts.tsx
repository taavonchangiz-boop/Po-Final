import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { ApiError } from '../../lib/api';

/**
 * Publishing feature shared bits (task 4-d-1): defensive backend types
 * (verified against app/src/modules/publishing/*), Persian label maps and the
 * error / plan-limit presentation blocks used by PublishingPage and
 * SchedulingPage.
 */

/* --------------------------------- types --------------------------------- */

export interface PostRecord {
  id: number | string;
  title?: string | null;
  body?: string;
  status?: string;
  scheduleAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
}

/** GET /posts/:id → { post, deliveries[] } — delivery rows carry a joined channel. */
export interface PostDetailDelivery {
  id: number | string;
  state?: string;
  attempts?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  sentAt?: string | null;
  channel?: {
    id?: number | string;
    provider?: string;
    title?: string | null;
    chatId?: string;
  } | null;
}

export interface PostDetail {
  post?: PostRecord;
  deliveries?: PostDetailDelivery[] | null;
}

export interface ScheduleRecord {
  id: number | string;
  postId?: number | string;
  postTitle?: string | null;
  runAt?: string;
  recurrence?: string | null;
  status?: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt?: string;
}

export interface ChannelLite {
  id: number | string;
  provider?: string;
  title?: string;
  chatId?: string;
  status?: string;
}

/* --------------------------------- labels -------------------------------- */

/** Recurrence enum: ONCE | DAILY | WEEKLY | MONTHLY (schedules zod). */
export const recurrenceLabels: Record<string, string> = {
  ONCE: 'یک‌بار',
  DAILY: 'روزانه',
  WEEKLY: 'هفته‌ای',
  MONTHLY: 'ماهانه',
};

export const scheduleStatusLabels: Record<string, string> = {
  ACTIVE: 'فعال',
  PAUSED: 'متوقف',
  DONE: 'انجام شد',
  CANCELLED: 'لغو شد',
};

/* ------------------------------ presentation ------------------------------ */

const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.';

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : GENERIC_ERROR;
}

/** PLAN_LIMIT (and the bots-style سقف CONFLICT) → upgrade-plan flow. */
export function planLimitMessage(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT') return e.message;
    if (e.code === 'CONFLICT' && e.message.includes('سقف')) return e.message;
  }
  return null;
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-red-200">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-red-700">{message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          تلاش مجدد
        </Button>
      </CardBody>
    </Card>
  );
}

export function PlanLimitBanner({ message }: { message: string }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-amber-800">{message}</p>
        <Link
          to="/app/subscription"
          className="focus-ring inline-flex h-8 shrink-0 items-center rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700"
        >
          ارتقای پلن
        </Link>
      </CardBody>
    </Card>
  );
}
