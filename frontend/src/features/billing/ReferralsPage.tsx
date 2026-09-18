import { UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Referrals — code, referred users, idempotent rewards arrives in task 4-d. */
export default function ReferralsPage() {
  usePageTitle('دعوت دوستان');
  return (
    <>
      <PageHeader
        title="دعوت دوستان"
        description="پاداش دعوت از دوستان به پُستیار"
      />
      <EmptyState
        icon={UserPlus}
        title="هنوز کسی را دعوت نکرده‌اید"
        description="کد دعوت خود را با دوستان به اشتراک بگذارید؛ با اولین پرداخت تأییدشدهٔ هر مهمان، پاداش به کیف پول شما اضافه می‌شود."
      />
    </>
  );
}
