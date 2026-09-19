import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CreditCard, MessagesSquare, Bot, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Card, CardBody } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import { get } from '../../lib/api';
import { faDate, faMoney, toFa } from '../../lib/format';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * «وضعیت اشتراک» widget for the dashboard overview (feedback item 11).
 * Data: GET /subscription/usage — effective plan + days remaining + usage vs
 * plan limits, verified against app/src/modules/billing/subscription.service.ts
 * (getUsageSummary): every counter mirrors the exact query its enforcing gate
 * runs, so the bars match what the backend will actually allow.
 *  { plan: {id, code, name, priceMonthly}, subscriptionStatus, expiresAt,
 *    daysRemaining, usage: { posts|channels|bots: {used, limit} } }
 */

interface UsageCounter {
  used?: number;
  limit?: number;
}

interface SubscriptionUsageResponse {
  plan?: { id?: number; code?: string; name?: string; priceMonthly?: number };
  subscriptionStatus?: string | null;
  expiresAt?: string | null;
  daysRemaining?: number | null;
  usage?: {
    posts?: UsageCounter;
    channels?: UsageCounter;
    bots?: UsageCounter;
  };
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعال',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغو شده',
  PENDING_PAYMENT: 'در انتظار پرداخت',
};

/** Bar fill color by pressure — calm teal → amber near the cap → red at ≥۹۰٪. */
function barToneClass(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-primary-600';
}

function UsageBar({
  label,
  used,
  limit,
  ariaLabel,
}: {
  label: ReactNode;
  used: number;
  limit: number;
  ariaLabel: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const remaining = Math.max(0, limit - used);
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-600">{label}</span>
        <span className="text-xs text-neutral-500">
          <span className="font-bold text-neutral-900">{toFa(used)}</span>
          {' از '}
          {toFa(limit)}
          {remaining > 0 ? ` · ${toFa(remaining)} باقی‌مانده` : ' · تکمیل'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${barToneClass(pct)}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

export default function SubscriptionStatusWidget() {
  const usage = useQuery({
    queryKey: ['subscription', 'usage'],
    queryFn: () => get<SubscriptionUsageResponse>('/subscription/usage'),
  });

  const data = usage.data;
  const planName = data?.plan?.name || 'رایگان';
  const price = data?.plan?.priceMonthly ?? 0;
  const days = data?.daysRemaining ?? null;
  const status = data?.subscriptionStatus ?? null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
        {/* --------------------------------- plan --------------------------------- */}
        <div className="min-w-0 sm:w-64 sm:shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <CreditCard aria-hidden="true" className="size-5 text-primary-700" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-neutral-500">وضعیت اشتراک</p>
              {usage.isLoading ? (
                <Skeleton className="mt-1 h-6 w-24" />
              ) : (
                <p className="truncate text-lg font-bold text-neutral-900">{planName}</p>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {status ? (
              <Badge state={status} labels={SUBSCRIPTION_STATUS_LABELS} />
            ) : (
              <Badge tone="neutral">بدون اشتراک فعال</Badge>
            )}
            {price > 0 ? (
              <span className="text-xs font-medium text-neutral-600">{faMoney(price)} /ماه</span>
            ) : (
              <span className="text-xs font-medium text-neutral-600">رایگان</span>
            )}
          </div>

          {usage.isLoading ? (
            <SkeletonText className="mt-3" lines={1} />
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs leading-6 text-neutral-500">
              <CalendarClock aria-hidden="true" className="size-3.5 shrink-0 text-neutral-400" />
              {data?.expiresAt && days !== null ? (
                <>
                  انقضا: {faDate(data.expiresAt)}
                  <span className="text-neutral-300">·</span>
                  <span className={days <= 7 ? 'font-semibold text-red-600' : 'font-medium text-neutral-700'}>
                    {days === 0 ? 'امروز منقضا می‌شود' : `${toFa(days)} روز باقی‌مانده`}
                  </span>
                </>
              ) : (
                'بدون محدودیت زمانی — سقف‌های پلن رایگان اعمال می‌شود.'
              )}
            </p>
          )}

          <Link
            to="/app/subscription"
            className="focus-ring mt-3 inline-flex items-center rounded text-xs font-medium text-primary-700 hover:underline"
          >
            مدیریت اشتراک و تمدید
          </Link>
        </div>

        {/* -------------------------------- usage -------------------------------- */}
        {usage.isLoading ? (
          <div className="flex-1 space-y-4 self-stretch">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-2 w-full" />
              </div>
            ))}
          </div>
        ) : usage.error ? (
          <div className="flex-1 self-stretch">
            <ErrorCard message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} />
          </div>
        ) : (
          <ul className="flex-1 space-y-4 self-stretch" aria-label="مصرف منابع در برابر سقف پلن">
            <UsageBar
              label={
                <span className="inline-flex items-center gap-1.5">
                  <FileText aria-hidden="true" className="size-3.5 text-neutral-400" />
                  پست‌های این ماه
                </span>
              }
              used={data?.usage?.posts?.used ?? 0}
              limit={data?.usage?.posts?.limit ?? 0}
              ariaLabel="مصرف پست ماهانه در برابر سقف پلن"
            />
            <UsageBar
              label={
                <span className="inline-flex items-center gap-1.5">
                  <MessagesSquare aria-hidden="true" className="size-3.5 text-neutral-400" />
                  کانال‌های متصل
                </span>
              }
              used={data?.usage?.channels?.used ?? 0}
              limit={data?.usage?.channels?.limit ?? 0}
              ariaLabel="مصرف کانال‌ها در برابر سقف پلن"
            />
            <UsageBar
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Bot aria-hidden="true" className="size-3.5 text-neutral-400" />
                  ربات‌های فعال
                </span>
              }
              used={data?.usage?.bots?.used ?? 0}
              limit={data?.usage?.bots?.limit ?? 0}
              ariaLabel="مصرف ربات‌ها در برابر سقف پلن"
            />
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
