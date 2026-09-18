import { Send } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Publishing — compose + outbox/deliveries UI arrives in task 4-d. */
export default function PublishingPage() {
  usePageTitle('انتشار');
  return (
    <>
      <PageHeader
        title="انتشار"
        description="ساخت پست و انتشار هم‌زمان در کانال‌های منتخب"
      />
      <EmptyState
        icon={Send}
        title="هنوز پستی ساخته نشده"
        description="اولین پست خود را بنویسید و هم‌زمان در کانال‌های تلگرام، بله و روبیکا منتشر کنید؛ وضعیت ارسالِ هر کانال جداگانه قابل پیگیری است."
      />
    </>
  );
}
