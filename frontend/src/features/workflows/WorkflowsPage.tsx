import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot as BotIcon, Pencil, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { del, get, patch } from '../../lib/api';
import { labelOf, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { ErrorCard, SwitchToggle } from '../bots/botUi';
import { errorMessage, triggerLabels, type BotRecord, type WorkflowRecord } from '../bots/botTypes';

/**
 * Workflows (task 4-d-1) — all workflows across bots.
 * GET /workflows?page&limit → serializeWorkflow(): { id, botId, name, definition,
 * isActive, runCount, … } (isActive/runCount differ from lib/types.ts `enabled`).
 * PATCH /workflows/:id accepts { isActive }; DELETE removes. «ویرایش» deep-links
 * to the bot detail workflows tab: /app/bots/:botId?tab=workflows.
 */

export default function WorkflowsPage() {
  usePageTitle('گردش‌کارها');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [deleting, setDeleting] = useState<WorkflowRecord | null>(null);

  const workflows = usePaged<WorkflowRecord>({
    queryKey: ['workflows', 'all'],
    buildPath: (page, limit) => `/workflows?page=${page}&limit=${limit}`,
  });

  // Bot names for the «ربات» column (single page of up to 100 bots is plenty for v1).
  const bots = useQuery({
    queryKey: ['bots', 'name-map'],
    queryFn: () => get<{ items: BotRecord[] }>('/bots?page=1&limit=100'),
  });

  const botNameById = new Map<string, string>();
  for (const b of bots.data?.items ?? []) {
    botNameById.set(String(b.id), b.title || b.username || `ربات ${b.id}`);
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, next }: { id: number | string; next: boolean }) =>
      patch(`/workflows/${id}`, { isActive: next }),
    onSuccess: (_data, vars) => {
      pushToast('success', vars.next ? 'گردش‌کار فعال شد.' : 'گردش‌کار غیرفعال شد.');
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => del(`/workflows/${id}`),
    onSuccess: () => {
      pushToast('success', 'گردش‌کار حذف شد.');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setDeleting(null);
    },
  });

  const isLoading = workflows.isLoading;

  return (
    <>
      <PageHeader
        title="گردش‌کارها"
        description="خودکارسازی پاسخ‌ها با محرک و گام‌های قابل تعریف"
      />

      <div className="space-y-4">
        {isLoading || bots.isLoading ? (
          <div className="space-y-3 rounded-card border border-neutral-200 bg-white p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : workflows.error ? (
          <ErrorCard
            message={errorMessage(workflows.error)}
            onRetry={() => void workflows.refetch()}
          />
        ) : workflows.items.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title="گردش‌کاری ساخته نشده"
            description="گردش‌کارها به ربات‌ها متصل می‌شوند؛ ابتدا یک ربات متصل کنید و سپس محرک و گام‌های خودکار را تعریف کنید."
            action={
              <Link
                to="/app/bots"
                className="focus-ring inline-flex h-10 items-center rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
              >
                <BotIcon aria-hidden="true" className="me-1.5 size-4" />
                فهرست ربات‌ها
              </Link>
            }
          />
        ) : (
          <>
            <Table caption="فهرست گردش‌کارها">
              <THead>
                <TR>
                  <TH>نام</TH>
                  <TH>ربات</TH>
                  <TH>محرک</TH>
                  <TH>فعال</TH>
                  <TH>تعداد اجرا</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {workflows.items.map((wf) => {
                  const botId = String(wf.botId ?? '');
                  return (
                    <TR key={String(wf.id)}>
                      <TD className="max-w-56 font-medium text-neutral-900">
                        <span className="block truncate">{wf.name || '—'}</span>
                      </TD>
                      <TD className="text-xs text-neutral-600">
                        {botNameById.get(botId) ?? (botId ? `ربات ${toFa(botId)}` : '—')}
                      </TD>
                      <TD className="text-xs text-neutral-600">
                        {labelOf(triggerLabels, wf.definition?.trigger?.type)}
                        {wf.definition?.trigger?.value
                          ? ` «${wf.definition.trigger.value}»`
                          : ''}
                      </TD>
                      <TD>
                        <SwitchToggle
                          checked={wf.isActive === true}
                          disabled={toggleMutation.isPending}
                          label={wf.isActive ? 'غیرفعال کردن گردش‌کار' : 'فعال کردن گردش‌کار'}
                          onChange={(next) => toggleMutation.mutate({ id: wf.id, next })}
                        />
                      </TD>
                      <TD className="text-xs text-neutral-600">{toFa(wf.runCount ?? 0)}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate(`/app/bots/${botId}?tab=workflows`)}
                            disabled={!botId}
                          >
                            <Pencil aria-hidden="true" className="size-4" />
                            ویرایش
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            disabled={deleteMutation.isPending}
                            onClick={() => setDeleting(wf)}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            حذف
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination
              page={workflows.page}
              totalPages={workflows.totalPages}
              onChange={workflows.setPage}
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
        loading={deleteMutation.isPending}
        title="حذف گردش‌کار"
        description={`آیا از حذف «${deleting?.name || 'این گردش‌کار'}» مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="بله، حذف کن"
      />
    </>
  );
}
