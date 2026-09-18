import { Users } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Admin users — list + role/status change (audited) arrives in task 4-d. */
export default function AdminUsersPage() {
  usePageTitle('مدیریت کاربران');
  return (
    <>
      <PageHeader
        title="کاربران"
        description="فهرست کاربران، نقش‌ها و وضعیت حساب‌ها"
      />
      <EmptyState
        icon={Users}
        title="کاربری یافت نشد"
        description="فهرست کاربران پس از ثبت‌نام آن‌ها اینجا نمایش داده می‌شود. رمزهای عبور هرگز در این بخش نمایش داده نمی‌شوند."
      />
    </>
  );
}
