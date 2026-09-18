import { ScrollText } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Admin audit — filterable audit trail arrives in task 4-d. */
export default function AdminAuditPage() {
  usePageTitle('رخدادهای سامانه');
  return (
    <>
      <PageHeader
        title="رخدادهای سامانه"
        description="ردپای رخدادهای حساس (ورود، تغییر نقش، پرداخت)"
      />
      <EmptyState
        icon={ScrollText}
        title="رخدادی ثبت نشده"
        description="تمام رخدادهای حساس سامانه با شناسه درخواست، کاربر و زمان دقیق (تقویم شمسی) اینجا ثبت و قابل جست‌وجو می‌شود."
      />
    </>
  );
}
