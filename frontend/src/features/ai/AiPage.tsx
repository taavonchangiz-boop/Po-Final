import { Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** AI — providers, queued jobs, usage quota UI arrives in task 4-d. */
export default function AiPage() {
  usePageTitle('هوش مصنوعی');
  return (
    <>
      <PageHeader
        title="هوش مصنوعی"
        description="تولید متن پست با مدل‌های زبانی و قالب‌های فارسی"
      />
      <EmptyState
        icon={Sparkles}
        title="هنوز کاری به هوش مصنوعی نسپرده‌اید"
        description="می‌توانید متن پست‌ها و پاسخ ربات‌ها را با هوش مصنوعی تولید کنید؛ اعتبار مصرفی بر اساس پلن اشتراک شما محاسبه می‌شود."
      />
    </>
  );
}
