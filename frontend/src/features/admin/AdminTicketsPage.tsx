import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Reply } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { Dialog } from '../../components/ui/Dialog';
import { Textarea } from '../../components/ui/Textarea';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, ApiError } from '../../lib/api';
import { faDateTime, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { adminTicketStatusLabels, adminTicketStatusTones } from './adminParts';

/**
 * Admin tickets — filtered list + staff reply. Verified against
 * app/src/modules/admin/admin.routes.ts + support/support.service.ts:
 *  - GET /admin/tickets?page&limit&status → { items, page, limit } — NOTE: no
 *    `total` is returned; «next page» is derived from items.length === limit.
 *  - Status filter enum: OPEN | ANSWERED | PENDING_USER | CLOSED.
 *  - POST /admin/tickets/:id/reply { body } → 201 { ticket, message } — flips
 *    status to ANSWERED + notifies the owner. There is NO GET /admin/tickets/:id
 *    and NO direct status-change endpoint (owner-scoped thread endpoint refuses
 *    staff access), so the thread cannot be read here — the reply dialog is
 *    honest about that and shows the ticket list data only.
 */

interface AdminTicketRecord {
  id: number | string;
  userId?: number;
  subject?: string;
  category?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

const STATUS_FILTERS = [
  { key: 'ALL', label: 'همه' },
  { key: 'OPEN', label: 'باز' },
  { key: 'ANSWERED', label: 'پاسخ داده شد' },
  { key: 'PENDING_USER', label: 'در انتظار کاربر' },
  { key: 'CLOSED', label: 'بسته' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: 'عمومی',
  BILLING: 'مالی',
  TECHNICAL: 'فنی',
  FEATURE: 'پیشنهاد',
};

const PAGE_SIZE = 20;

export default function AdminTicketsPage() {
  usePageTitle('مدیریت تیکت‌ها');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ['admin', 'tickets', statusFilter, page],
    placeholderData: (prev) => prev,
    queryFn: () =>
      get<{ items?: AdminTicketRecord[]; page?: number; limit?: number }>(
        `/admin/tickets?page=${page}&limit=${PAGE_SIZE}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`,
      ),
  });

  const items = list.data?.items ?? [];
  // No total from the API: allow advancing while the page comes back full.
  const totalPages = items.length === PAGE_SIZE ? page + 1 : page;

  const [replyTarget, setReplyTarget] = useState<AdminTicketRecord | null>(null);
  const [replyText, setReplyText] = useState('');

  const replyMutation = useMutation({
    mutationFn: () =>
      post<{ ticket?: AdminTicketRecord; message?: { id: number | string } }>(
        `/admin/tickets/${String(replyTarget?.id)}/reply`,
        { body: replyText.trim() },
      ),
    onSuccess: () => {
      pushToast('success', 'پاسخ شما ثبت شد و به کاربر اطلاع داده شد.');
      setReplyTarget(null);
      setReplyText('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitReply() {
    const len = replyText.trim().length;
    if (len < 1 || len > 5000) {
      pushToast('error', 'متن پاسخ باید بین ۱ تا ۵۰۰۰ کاراکتر باشد.');
      return;
    }
    replyMutation.mutate();
  }

  return (
    <>
      <PageHeader title="تیکت‌ها" description="درخواست‌های پشتیبانی کاربران" />

      <div className="space-y-4">
        <Tabs
          ariaLabel="فیلتر وضعیت تیکت"
          items={STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label }))}
          active={statusFilter}
          onChange={(key) => {
            setStatusFilter(key);
            setPage(1);
          }}
        />

        {list.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="تیکتی با این وضعیت وجود ندارد"
            description="تیکت‌های جدید کاربران به‌محض ثبت اینجا نمایش داده می‌شوند."
          />
        ) : (
          <>
            <Table caption="فهرست تیکت‌های کاربران">
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>موضوع</TH>
                  <TH>دسته</TH>
                  <TH>وضعیت</TH>
                  <TH>ایجاد</TH>
                  <TH>آخرین بروزرسانی</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((ticket) => (
                  <TR key={String(ticket.id)}>
                    <TD className="text-xs text-neutral-400">{toFa(String(ticket.id))}</TD>
                    <TD className="max-w-64 truncate font-medium text-neutral-900">{ticket.subject || '—'}</TD>
                    <TD>{CATEGORY_LABELS[ticket.category ?? ''] ?? ticket.category}</TD>
                    <TD>
                      <Badge tone={adminTicketStatusTones[ticket.status ?? ''] ?? 'neutral'}>
                        {adminTicketStatusLabels[ticket.status ?? ''] ?? ticket.status}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDateTime(ticket.createdAt)}</TD>
                    <TD className="text-xs text-neutral-500">{faDateTime(ticket.updatedAt)}</TD>
                    <TD>
                      {ticket.status === 'CLOSED' ? (
                        <span className="text-xs text-neutral-400">بسته‌شده</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setReplyTarget(ticket);
                            setReplyText('');
                          }}
                        >
                          <Reply aria-hidden="true" className="size-4" />
                          پاسخ
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination className="mt-4" page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}

        <p className="text-xs leading-6 text-neutral-400">
          متن گفت‌وگوی کاربر از این بخش نمایش داده نمی‌شود (دسترسی به گفت‌وگو فقط برای مالک تیکت است). پاسخ شما به‌صورت «پشتیبانی» ثبت و وضعیت تیکت به «پاسخ داده شد» تغییر می‌کند؛ کاربر با اعلان مطلع می‌شود.
        </p>
      </div>

      {/* reply dialog */}
      <Dialog
        open={replyTarget !== null}
        onClose={() => setReplyTarget(null)}
        title={`پاسخ به تیکت #${toFa(String(replyTarget?.id ?? ''))}`}
        description={replyTarget?.subject ?? undefined}
        size="md"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Badge tone={adminTicketStatusTones[replyTarget?.status ?? ''] ?? 'neutral'}>
              {adminTicketStatusLabels[replyTarget?.status ?? ''] ?? replyTarget?.status}
            </Badge>
            <span>دسته: {CATEGORY_LABELS[replyTarget?.category ?? ''] ?? replyTarget?.category}</span>
            <span>ایجاد: {faDateTime(replyTarget?.createdAt)}</span>
          </div>
          <Textarea
            label="متن پاسخ"
            rows={5}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            hint={`${toFa(replyText.length)} از ۵۰۰۰ کاراکتر`}
          />
          <div className="flex items-center gap-2">
            <Button loading={replyMutation.isPending} onClick={submitReply}>
              ارسال پاسخ
            </Button>
            <Button variant="ghost" onClick={() => setReplyTarget(null)} disabled={replyMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
