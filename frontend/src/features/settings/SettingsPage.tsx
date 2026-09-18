import { Settings as SettingsIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Settings — profile, security (change-password), tenant prefs arrive in 4-d. */
export default function SettingsPage() {
  usePageTitle('تنظیمات');
  return (
    <>
      <PageHeader
        title="تنظیمات"
        description="پروفایل، امنیت و ترجیحات حساب"
      />
      <EmptyState
        icon={SettingsIcon}
        title="تنظیماتی برای نمایش نیست"
        description="ویرایش پروفایل، تغییر رمز عبور و ترجیحات اعلان‌ها از همین بخش قابل مدیریت خواهد بود."
      />
    </>
  );
}
