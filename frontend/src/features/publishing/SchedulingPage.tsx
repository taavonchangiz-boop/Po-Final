import { CalendarClock } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Scheduling — Jalali picker + schedule management arrives in task 4-d. */
export default function SchedulingPage() {
  usePageTitle('زمان‌بندی');
  return (
    <>
      <PageHeader
        title="زمان‌بندی"
        description="انتشار خودکار با تقویم جلالی و ساعت ایران"
      />
      <EmptyState
        icon={CalendarClock}
        title="زمان‌بندی فعالی ندارید"
        description="برای انتشار خودکار، پست‌های خود را با تقویم جلالی زمان‌بندی کنید؛ می‌توانید هر زمان آن‌ها را متوقف یا لغو کنید."
      />
    </>
  );
}
