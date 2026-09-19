import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, LifeBuoy, Reply } from 'lucide-react';
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
import { faDateTime, faNumber, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { adminTicketStatusLabels, adminTicketStatusTones } from './adminParts';

/**
 * Admin tickets — filtered list + staff reply with thread + attachments.
 * Verified against app/src/modules/admin/admin.routes.ts + support/support.service.ts:
 *  - GET /admin/tickets?page&limit&status → { items, page, limit } — NOTE: no
 *    `total` is returned; «next page» is derived from items.length === limit.
 *  - Status filter enum: OPEN | ANSWERED | PENDING_USER | CLOSED.
 *  - GET /admin/tickets/:id → { ticket, messages: [...attachment {id,
 *    originalName, mime, size} | null] } — admin thread incl. attachments.
 *  - POST /admin/tickets/:id/reply { body } → 201 { ticket, message } — flips
 *    status to ANSWERED + notifies the owner.
 *  - Attachments download via GET /support/attachments/:id (owner or staff;
 *    admins pass the staff check server-side).
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

interface AdminTicketMessageRecord {
  id: number | string;
  senderUserId?: number | null;
  isStaff?: boolean;
  body?: string;
  createdAt?: string;
  attachment?: { id: number; originalName: string; mime: string; size: number } | null;
}

function faFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${faNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} مگابایت`;
  return `${faNumber(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
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

  const thread = useQuery({
    queryKey: ['admin', 'ticket-thread', replyTarget?.id],
    enabled: replyTarget !== null,
    queryFn: () =>
      get<{ ticket?: AdminTicketRecord; messages?: AdminTicketMessageRecord[] }>(
        `/admin/tickets/${String(replyTarget?.id)}`,
      ),
  });
  const threadMessages = thread.data?.messages ?? [];

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
          در دیالوگ «پاسخ»، گفت‌وگوی تیکت و پیوست‌های کاربر (تصویر/PDF) نمایش داده می‌شود و می‌توانید آن‌ها را دانلود کنید. پاسخ شما به‌صورت «پشتیبانی» ثبت و وضعیت تیکت به «پاسخ داده شد» تغییر می‌کند؛ کاربر با اعلان مطلع می‌شود.
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
          <div>
            <h3 className="mb-2 text-xs font-bold text-neutral-500">گفت‌وگوی تیکت</h3>
            {thread.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : thread.error ? (
              <p className="text-xs text-red-600">خواندن گفت‌وگو ناموفق بود؛ {errorMessage(thread.error)}</p>
            ) : threadMessages.length === 0 ? (
              <p className="text-xs text-neutral-400">پیامی ثبت نشده است.</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto pe-1">
                {threadMessages.map((message) => {
                  const staff = message.isStaff === true;
                  return (
                    <li
                      key={String(message.id)}
                      className={
                        'rounded-xl border px-3 py-2 text-sm leading-6 ' +
                        (staff ? 'border-primary-200 bg-primary-50/60' : 'border-neutral-200 bg-neutral-50')
                      }
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                        <span className={staff ? 'font-bold text-primary-800' : 'font-bold text-neutral-700'}>
                          {staff ? 'پشتیبانی' : `کاربر #${toFa(String(message.senderUserId ?? '—'))}`}
                        </span>
                        <time dateTime={message.createdAt}>{faDateTime(message.createdAt)}</time>
                      </div>
                      <p className="whitespace-pre-wrap text-neutral-800">{message.body}</p>
                      {message.attachment ? (
                        <a
                          href={`/api/v1/support/attachments/${String(message.attachment.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:border-primary-300 hover:text-primary-800"
                          title="دانلود پیوست"
                        >
                          <Download aria-hidden="true" className="size-3 shrink-0 text-primary-700" />
                          <FileText aria-hidden="true" className="size-3 shrink-0 text-neutral-400" />
                          <span className="truncate">{message.attachment.originalName}</span>
                          {typeof message.attachment.size === 'number' ? (
                            <span className="shrink-0 text-neutral-400">{faFileSize(message.attachment.size)}</span>
                          ) : null}
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
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
