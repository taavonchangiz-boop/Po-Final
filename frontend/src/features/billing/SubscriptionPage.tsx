import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Subscription — plans, gateway checkout, expiry arrives in task 4-d. */
export default function SubscriptionPage() {
  usePageTitle('اشتراک');
  return (
    <>
      <PageHeader
        title="اشتراک"
        description="پلن فعلی، سقف‌ها و تاریخ تمدید"
      />
      <EmptyState
        icon={CreditCard}
        title="اشتراک فعالی ندارید"
        description="برای دسترسی به ظرفیت بیشتر کانال‌ها و پست‌ها، یکی از پلن‌های اشتراک را فعال کنید. پرداخت‌ها به‌صورت امن و ریالی انجام می‌شود."
        action={
          <Link
            to="/app/wallet"
            className="focus-ring inline-flex h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            مشاهده کیف پول
          </Link>
        }
      />
    </>
  );
}
