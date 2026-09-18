import { Layers } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Admin plans — plan management (names, prices, limits) arrives in task 4-d. */
export default function AdminPlansPage() {
  usePageTitle('پلن‌های اشتراک');
  return (
    <>
      <PageHeader
        title="پلن‌های اشتراک"
        description="نام، قیمت (ریال) و سقف هر پلن"
      />
      <EmptyState
        icon={Layers}
        title="پلنی برای مدیریت وجود ندارد"
        description="پلن‌های اشتراک و سقف کانال، پست، اعتبار هوش مصنوعی و فضای ذخیره‌سازی از این بخش مدیریت می‌شود."
      />
    </>
  );
}
