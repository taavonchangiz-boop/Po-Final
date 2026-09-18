import { BarChart3 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Analytics — KPI cards, daily series, domain reports arrive in task 4-d. */
export default function AnalyticsPage() {
  usePageTitle('گزارش‌ها');
  return (
    <>
      <PageHeader
        title="گزارش‌ها"
        description="عملکرد انتشار، کانال‌ها، ربات‌ها و هوش مصنوعی"
      />
      <EmptyState
        icon={BarChart3}
        title="گزارشی موجود نیست"
        description="با شروع انتشار، گزارش‌های روزانه، نرخ موفقیت ارسال و عملکرد هر کانال اینجا ساخته می‌شود."
      />
    </>
  );
}
