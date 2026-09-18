import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Channels — list/connect/verify UI arrives in task 4-d. */
export default function ChannelsPage() {
  usePageTitle('کانال‌ها');
  return (
    <>
      <PageHeader
        title="کانال‌ها"
        description="اتصال و مدیریت کانال‌های تلگرام، بله و روبیکا"
      />
      <EmptyState
        icon={MessagesSquare}
        title="هنوز کانالی متصل نکرده‌اید"
        description="اولین کانال خود را اضافه کنید تا بتوانید محتوا در آن منتشر شود. اعتبار ربات با getChat بررسی و رمزنگاری می‌شود."
      />
    </>
  );
}
