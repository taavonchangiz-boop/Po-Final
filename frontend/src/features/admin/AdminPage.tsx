import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, LifeBuoy, ScrollText, Send, Shield, Users } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faMoney, faNumber } from '../../lib/format';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Admin dashboard — platform KPIs + quick links to the admin sub-pages.
 * Shape verified against app/src/modules/admin/admin.service.ts:
 *  GET /admin/stats → { users, activeSubscriptions, paymentsVerifiedMonthTotal,
 *  deliveriesSent30d, openTickets }.
 */

interface AdminStats {
  users?: number;
  activeSubscriptions?: number;
  paymentsVerifiedMonthTotal?: number;
  deliveriesSent30d?: number;
  openTickets?: number;
}

const QUICK_LINKS = [
  { to: '/app/admin/users', label: 'کاربران', description: 'نقش‌ها، وضعیت و جست‌وجو', icon: Users },
  { to: '/app/admin/tickets', label: 'تیکت‌ها', description: 'پاسخ به درخواست‌های کاربران', icon: LifeBuoy },
  { to: '/app/admin/plans', label: 'پلن‌ها', description: 'قیمت و سقف هر پلن', icon: CreditCard },
  { to: '/app/admin/audit', label: 'رخدادهای مدیریتی', description: 'گزارش کامل اقدامات', icon: ScrollText },
] as const;

export default function AdminPage() {
  usePageTitle('داشبورد مدیریت');

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => get<AdminStats>('/admin/stats'),
  });

  return (
    <>
      <PageHeader
        title="داشبورد مدیریت"
        description="نمای کلی وضعیت پلتفرم"
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800">
            <Shield aria-hidden="true" className="size-3.5" />
            دسترسی مدیر
          </span>
        }
      />

      <div className="space-y-6">
        {stats.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Stat
                key={i}
                label="…"
                value={<span className="inline-block h-7 w-16 animate-pulse rounded bg-neutral-200" />}
              />
            ))}
          </div>
        ) : stats.error ? (
          <ErrorCard message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="کاربران" value={faNumber(stats.data?.users ?? 0)} icon={Users} />
            <Stat label="اشتراک فعال" value={faNumber(stats.data?.activeSubscriptions ?? 0)} icon={CreditCard} />
            <Stat
              label="درآمد ماه جاری"
              value={faMoney(stats.data?.paymentsVerifiedMonthTotal ?? 0)}
              icon={CreditCard}
              hint="مجموع پرداخت‌های تأییدشده"
            />
            <Stat label="ارسال ۳۰ روزه" value={faNumber(stats.data?.deliveriesSent30d ?? 0)} icon={Send} />
            <Stat label="تیکت باز" value={faNumber(stats.data?.openTickets ?? 0)} icon={LifeBuoy} hint="باز + در انتظار کاربر" />
          </div>
        )}

        {/* Quick links to sub-pages */}
        <section aria-label="دسترسی سریع مدیریتی">
          <h2 className="mb-3 text-base font-semibold text-neutral-900">مدیریت</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="focus-ring flex items-center gap-3 rounded-card border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                  <link.icon aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{link.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{link.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
