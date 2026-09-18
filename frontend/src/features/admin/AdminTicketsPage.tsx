import { Ticket } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Admin tickets — operational list + staff replies arrive in task 4-d. */
export default function AdminTicketsPage() {
  usePageTitle('تیکت‌های پشتیبانی');
  return (
    <>
      <PageHeader
        title="تیکت‌های پشتیبانی"
        description="پاسخ‌گویی به درخواست‌های کاربران"
      />
      <EmptyState
        icon={Ticket}
        title="تیکتی برای پاسخ‌گویی وجود ندارد"
        description="تیکت‌های ثبت‌شدهٔ کاربران با وضعیت «باز»، «در حال بررسی» و «پاسخ داده شد» اینجا نمایش داده می‌شود."
      />
    </>
  );
}
