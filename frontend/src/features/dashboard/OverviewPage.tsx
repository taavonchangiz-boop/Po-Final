import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bot,
  Bell,
  MessagesSquare,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faNumber, faPercent, faDateTime } from '../../lib/format';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { eventLabels } from '../analytics/analyticsParts';

/**
 * Overview — GET /analytics/overview KPIs + quick actions + activity timeline.
 * Response shape verified against app/src/modules/analytics/analytics.service.ts:
 *  { postsSent, deliveryFailed, successRate (0..1 | null), botMessages,
 *    aiCredits: { used, quota, month }, activeChannels, unreadNotifications }
 * Timeline rows: { id, type, subjectType, subjectId, data, createdAt }.
 */

interface OverviewResponse {
  postsSent?: number;
  deliveryFailed?: number;
  successRate?: number | null;
  botMessages?: number;
  aiCredits?: { used?: number; quota?: number; month?: string };
  activeChannels?: number;
  unreadNotifications?: number;
}

interface TimelineItem {
  id: number | string;
  type?: string;
  subjectType?: string | null;
  subjectId?: number | null;
  data?: Record<string, unknown> | null;
  createdAt?: string;
}

const RANGES = [
  { days: 7, label: '۷ روز' },
  { days: 14, label: '۱۴ روز' },
  { days: 30, label: '۳۰ روز' },
] as const;

function rangeLabel(days: number): string {
  return RANGES.find((r) => r.days === days)?.label ?? '';
}

function timelineLabel(item: TimelineItem): string {
  const raw = item.type ?? '';
  return eventLabels[raw] ?? raw;
}

function timelineDetail(item: TimelineItem): string | null {
  const data = item.data;
  if (data === null || data === undefined) return null;
  if (typeof data['title'] === 'string' && data['title'].length > 0) return data['title'];
  if (typeof data['provider'] === 'string' && data['provider'].length > 0) return data['provider'];
  return null;
}

export default function OverviewPage() {
  usePageTitle('نمای کلی');
  const [days, setDays] = useState<number>(14);

  const overview = useQuery({
    queryKey: ['analytics', 'overview', days],
    queryFn: () => get<OverviewResponse>(`/analytics/overview?days=${days}`),
  });

  const timeline = useQuery({
    queryKey: ['analytics', 'timeline', 'overview'],
    queryFn: () =>
      get<{ items?: TimelineItem[]; nextCursor?: number | null }>('/analytics/timeline?limit=10'),
  });

  const data = overview.data;
  const firstRun =
    data !== undefined &&
    (data.activeChannels ?? 0) === 0 &&
    (data.postsSent ?? 0) === 0 &&
    (data.botMessages ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="نمای کلی"
        description="خلاصهٔ وضعیت انتشار، ربات‌ها و اعتبار حساب شما"
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                aria-pressed={days === r.days}
                className={
                  'focus-ring rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (days === r.days
                    ? 'bg-white text-primary-800 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {overview.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
            </Card>
          ))}
        </div>
      ) : overview.error ? (
        <ErrorCard message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
      ) : firstRun ? (
        <EmptyState
          icon={Send}
          title="به پُستیار خوش آمدید!"
          description="با اتصال اولین کانال شروع کنید. سپس پست بسازید و در تلگرام، بله و روبیکا هم‌زمان منتشر کنید."
          action={
            <Link
              to="/app/channels"
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
            >
              <Plus aria-hidden="true" className="size-4" />
              افزودن اولین کانال
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="ارسال‌های موفق"
              value={faNumber(data?.postsSent ?? 0)}
              icon={Send}
              hint={`${rangeLabel(days)} گذشته`}
            />
            <Stat
              label="نرخ موفقیت"
              value={
                data?.successRate === null || data?.successRate === undefined
                  ? '—'
                  : faPercent((data.successRate ?? 0) * 100)
              }
              icon={Activity}
              hint={`ارسال ناموفق: ${faNumber(data?.deliveryFailed ?? 0)}`}
            />
            <Stat
              label="پیام‌های ربات"
              value={faNumber(data?.botMessages ?? 0)}
              icon={Bot}
              hint={`${rangeLabel(days)} گذشته`}
            />
            <Stat
              label="اعتبار هوش مصنوعی مصرفی"
              value={faNumber(data?.aiCredits?.used ?? 0)}
              icon={Sparkles}
              hint={`سهمیه ماه: ${faNumber(data?.aiCredits?.quota ?? 0)}`}
            />
            <Stat label="کانال‌های فعال" value={faNumber(data?.activeChannels ?? 0)} icon={MessagesSquare} />
          </div>

          {/* Quick actions */}
          <section aria-label="دسترسی سریع" className="grid gap-3 sm:grid-cols-3">
            <Link
              to="/app/publishing"
              className="focus-ring flex items-center gap-3 rounded-card border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                <Send aria-hidden="true" className="size-5 text-primary-700" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-neutral-900">پست جدید</span>
                <span className="mt-0.5 block text-xs text-neutral-500">ساخت و انتشار در همه کانال‌ها</span>
              </span>
            </Link>
            <Link
              to="/app/channels"
              className="focus-ring flex items-center gap-3 rounded-card border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                <MessagesSquare aria-hidden="true" className="size-5 text-primary-700" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-neutral-900">افزودن کانال</span>
                <span className="mt-0.5 block text-xs text-neutral-500">تلگرام، بله یا روبیکا</span>
              </span>
            </Link>
            <Link
              to="/app/bots"
              className="focus-ring flex items-center gap-3 rounded-card border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                <Bot aria-hidden="true" className="size-5 text-primary-700" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-neutral-900">اتصال ربات</span>
                <span className="mt-0.5 block text-xs text-neutral-500">پاسخ‌گویی خودکار و گردش‌کارها</span>
              </span>
            </Link>
          </section>

          {/* Unread notifications link */}
          <Link
            to="/app/notifications"
            className="focus-ring flex items-center justify-between gap-3 rounded-card border border-neutral-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-primary-300"
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                <Bell aria-hidden="true" className="size-5 text-primary-700" />
              </span>
              <span className="text-sm font-medium text-neutral-900">اعلان‌های خوانده‌نشده</span>
            </span>
            <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
              {faNumber(data?.unreadNotifications ?? 0)}
            </span>
          </Link>

          {/* Recent activity */}
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>فعالیت‌های اخیر</CardTitle>
              <Link
                to="/app/analytics"
                className="focus-ring rounded text-xs font-medium text-primary-700 hover:underline"
              >
                گزارش کامل
              </Link>
            </CardHeader>
            <CardBody>
              {timeline.isLoading ? (
                <SkeletonText lines={5} />
              ) : timeline.error ? (
                <ErrorCard
                  message={errorMessage(timeline.error)}
                  onRetry={() => void timeline.refetch()}
                />
              ) : (timeline.data?.items ?? []).length === 0 ? (
                <EmptyState
                  title="هنوز فعالیتی ثبت نشده است"
                  description="پس از اولین انتشار یا پیام ربات، رخدادها اینجا نمایش داده می‌شوند."
                />
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {(timeline.data?.items ?? []).map((item) => {
                    const detail = timelineDetail(item);
                    return (
                      <li key={String(item.id)} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-neutral-800">{timelineLabel(item)}</p>
                          {detail && <p className="mt-0.5 truncate text-xs text-neutral-500">{detail}</p>}
                        </div>
                        <time className="shrink-0 text-xs text-neutral-400" dateTime={item.createdAt}>
                          {faDateTime(item.createdAt)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
