import { Link, useParams } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/**
 * Bot detail — health, webhook state, commands, events and bot users UI
 * arrives in task 4-d. Route: /app/bots/:id
 */
export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  usePageTitle('جزئیات ربات');
  return (
    <>
      <PageHeader
        title="جزئیات ربات"
        description="سلامت ربات، دستورها، رویدادها و کاربران"
      />
      <EmptyState
        icon={Bot}
        title="اطلاعات این ربات هنوز آماده نیست"
        description={
          id
            ? 'جزئیات سلامت، دستورها و رویدادهای اخیر این ربات به‌زودی در همین صفحه نمایش داده می‌شود.'
            : 'ابتدا از فهرست ربات‌ها یک ربات را انتخاب کنید.'
        }
        action={
          <Link
            to="/app/bots"
            className="focus-ring inline-flex h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            بازگشت به فهرست ربات‌ها
          </Link>
        }
      />
    </>
  );
}
