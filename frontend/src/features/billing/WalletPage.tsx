import { Wallet as WalletIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Wallet — ledger with balance_after, top-up arrives in task 4-d. */
export default function WalletPage() {
  usePageTitle('کیف پول');
  return (
    <>
      <PageHeader
        title="کیف پول"
        description="موجودی، گردش حساب و شارژ"
      />
      <EmptyState
        icon={WalletIcon}
        title="گردشی در کیف پول ثبت نشده"
        description="برای پرداخت‌های سریع‌تر اشتراک، کیف پول خود را شارژ کنید؛ تمام تراکنش‌ها با رسید و تاریخ شمسی ثبت می‌شوند."
      />
    </>
  );
}
