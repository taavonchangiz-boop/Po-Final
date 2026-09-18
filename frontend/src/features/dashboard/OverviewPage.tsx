import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Overview — real KPI wiring arrives in task 4-d. */
export default function OverviewPage() {
  usePageTitle('نمای کلی');
  return (
    <>
      <PageHeader
        title="نمای کلی"
        description="خلاصهٔ وضعیت انتشار، ربات‌ها و اعتبار حساب شما"
      />
      <EmptyState
        icon={LayoutDashboard}
        title="هنوز داده‌ای برای نمایش نیست"
        description="پس از اتصال کانال و انتشار اولین پست، آمار کلی و شاخص‌های عملکرد اینجا نمایش داده می‌شود."
        action={
          <Link
            to="/app/channels"
            className="focus-ring inline-flex h-10 items-center rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
          >
            افزودن اولین کانال
          </Link>
        }
      />
    </>
  );
}
