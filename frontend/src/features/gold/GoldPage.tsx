import { Coins } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Gold — price entry, per-channel configs, formatted publishes arrives in 4-d. */
export default function GoldPage() {
  usePageTitle('طلا');
  return (
    <>
      <PageHeader
        title="طلا"
        description="انتشار خودکار و قالب‌بندی‌شدهٔ نرخ طلا و ارز"
      />
      <EmptyState
        icon={Coins}
        title="قیمتی ثبت نشده"
        description="برای انتشار خودکار نرخ‌ها، ابتدا قیمت‌ها را وارد یا منبع دریافت نرخ را تنظیم کنید؛ انتشار با ارقام فارسی و تاریخ شمسی انجام می‌شود."
      />
    </>
  );
}
