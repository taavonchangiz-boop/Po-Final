import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Admin overview — platform KPIs arrive in task 4-d (SUPER_ADMIN/ADMIN only). */
export default function AdminPage() {
  usePageTitle('مدیریت');
  return (
    <>
      <PageHeader
        title="مدیریت سامانه"
        description="شاخص‌های کلیدی پلتفرم، کاربران و پرداخت‌ها"
      />
      <EmptyState
        icon={Shield}
        title="آمار کلی هنوز خالی است"
        description="شاخص‌های کاربران، انتشار و درآمد پس از ثبت فعالیت در سامانه اینجا نمایش داده می‌شود."
        action={
          <Link
            to="/app/admin/users"
            className="focus-ring inline-flex h-10 items-center rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
          >
            مدیریت کاربران
          </Link>
        }
      />
    </>
  );
}
