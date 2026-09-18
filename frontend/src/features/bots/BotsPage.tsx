import { Bot } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Bots — connect/verify/commands UI arrives in task 4-d. */
export default function BotsPage() {
  usePageTitle('ربات‌ها');
  return (
    <>
      <PageHeader
        title="ربات‌ها"
        description="اتصال ربات‌های تلگرام و بله و مدیریت آن‌ها"
      />
      <EmptyState
        icon={Bot}
        title="هنوز رباتی متصل نکرده‌اید"
        description="با اتصال ربات، پاسخ‌گویی خودکار، گردش‌کارها و پاسخ‌های هوش مصنوعی در گروه‌ها و کانال‌های شما فعال می‌شود."
      />
    </>
  );
}
