import { ShoppingBag } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** WooCommerce — site pairing, product sync, auto-publish arrives in task 4-d. */
export default function WooPage() {
  usePageTitle('ووکامرس');
  return (
    <>
      <PageHeader
        title="ووکامرس"
        description="انتشار خودکار محصولات فروشگاه ووکامرسی شما"
      />
      <EmptyState
        icon={ShoppingBag}
        title="فروشگاه ووکامرسی متصل نیست"
        description="با نصب افزونهٔ «پُستیار کانکتور» در وردپرس و جفت‌کردن امن فروشگاه، محصولات شما به‌صورت خودکار در کانال‌ها منتشر می‌شوند."
      />
    </>
  );
}
