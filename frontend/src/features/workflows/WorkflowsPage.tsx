import { Workflow as WorkflowIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePageTitle } from '../../app/usePageTitle';

/** Workflows — trigger/step builder + run history arrives in task 4-d. */
export default function WorkflowsPage() {
  usePageTitle('گردش‌کارها');
  return (
    <>
      <PageHeader
        title="گردش‌کارها"
        description="خودکارسازی پاسخ‌ها با محرک و گام‌های قابل تعریف"
      />
      <EmptyState
        icon={WorkflowIcon}
        title="گردش‌کاری ساخته نشده"
        description="گردش‌کارها به ربات‌ها متصل می‌شوند؛ ابتدا یک ربات متصل کنید و سپس محرک و گام‌های خودکار را تعریف کنید."
      />
    </>
  );
}
