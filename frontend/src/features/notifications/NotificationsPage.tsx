import { Bell } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Notifications — in-app + channel fan-out, read states arrive in task 4-d. */
export default function NotificationsPage() {
  usePageTitle('اعلان‌ها');
  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        description="رویدادهای مهم انتشار و حساب شما"
      />
      <EmptyState
        icon={Bell}
        title="اعلان جدیدی ندارید"
        description="وضعیت انتشار پست‌ها، هشدارهای اشتراک و پیام‌های سامانه اینجا نمایش داده می‌شود."
      />
    </>
  );
}
