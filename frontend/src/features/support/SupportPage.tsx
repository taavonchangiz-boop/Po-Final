import { LifeBuoy } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Support — tickets + thread + staff replies arrive in task 4-d. */
export default function SupportPage() {
  usePageTitle('پشتیبانی');
  return (
    <>
      <PageHeader
        title="پشتیبانی"
        description="ثبت تیکت و پیگیری پاسخ تیم پُستیار"
      />
      <EmptyState
        icon={LifeBuoy}
        title="تیکتی ثبت نشده"
        description="برای هر پرسش یا مشکل فنی، تیکت پشتیبانی جدید بسازید؛ پاسخ‌ها در همین صفحه اطلاع‌رسانی می‌شود."
      />
    </>
  );
}
