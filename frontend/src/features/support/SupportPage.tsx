import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus, Send } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, ApiError } from '../../lib/api';
import { faDateTime, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Support — user tickets: list, create, thread dialog, reply.
 * Shapes verified against app/src/modules/support/support.routes.ts + service:
 *  - GET /support/tickets?page&limit → { items: [{ id, userId, subject, category,
 *    status, createdAt, updatedAt }], total, page, limit }.
 *  - POST /support/tickets { subject (3..190), category (GENERAL|BILLING|
 *    TECHNICAL|FEATURE), body (10..5000) } → 201 { ticket }.
 *  - GET /support/tickets/:id → { ticket, messages: [{ id, ticketId, senderUserId,
 *    isStaff, body, attachmentId, createdAt, attachment }] } (ascending).
 *  - POST /support/tickets/:id/messages { body } → { ticket, message } —
 *    user reply flips status to OPEN, staff reply to ANSWERED; replies to a
 *    CLOSED ticket are rejected server-side.
 *  Status enum: OPEN | ANSWERED | PENDING_USER | CLOSED (lib/format's map has
 *  IN_PROGRESS which never occurs).
 */

interface TicketRecord {
  id: number | string;
  subject?: string;
  category?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TicketMessageRecord {
  id: number | string;
  senderUserId?: number | null;
  isStaff?: boolean;
  body?: string;
  createdAt?: string;
  attachment?: { id: number; originalName: string; mime: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'باز',
  ANSWERED: 'پاسخ داده شد',
  PENDING_USER: 'در انتظار پاسخ شما',
  CLOSED: 'بسته',
};

const STATUS_TONES: Record<string, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = {
  OPEN: 'info',
  ANSWERED: 'success',
  PENDING_USER: 'warning',
  CLOSED: 'neutral',
};

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: 'عمومی',
  BILLING: 'مالی',
  TECHNICAL: 'فنی',
  FEATURE: 'پیشنهاد',
};

export default function SupportPage() {
  usePageTitle('پشتیبانی');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [body, setBody] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [openTicket, setOpenTicket] = useState<TicketRecord | null>(null);
  const [replyText, setReplyText] = useState('');

  const invalidateTickets = () => {
    void queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
    void queryClient.invalidateQueries({ queryKey: ['support', 'thread'] });
  };

  const list = usePaged<TicketRecord>({
    queryKey: ['support', 'tickets'],
    buildPath: (page, limit) => `/support/tickets?page=${page}&limit=${limit}`,
  });

  const thread = useQuery({
    queryKey: ['support', 'thread', openTicket?.id],
    enabled: openTicket !== null,
    queryFn: () =>
      get<{ ticket?: TicketRecord; messages?: TicketMessageRecord[] }>(
        `/support/tickets/${String(openTicket?.id)}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      post<{ ticket?: TicketRecord }>('/support/tickets', {
        subject: subject.trim(),
        category,
        body: body.trim(),
      }),
    onSuccess: () => {
      pushToast('success', 'تیکت شما ثبت شد؛ کارشناسان ما به‌زودی پاسخ می‌دهند.');
      setCreateOpen(false);
      setSubject('');
      setCategory('GENERAL');
      setBody('');
      invalidateTickets();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      post<{ ticket?: TicketRecord; message?: TicketMessageRecord }>(
        `/support/tickets/${String(openTicket?.id)}/messages`,
        { body: replyText.trim() },
      ),
    onSuccess: () => {
      pushToast('success', 'پاسخ شما ثبت شد.');
      setReplyText('');
      invalidateTickets();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitTicket() {
    const errors: Record<string, string> = {};
    if (subject.trim().length < 3 || subject.trim().length > 190)
      errors.subject = 'موضوع بین ۳ تا ۱۹۰ کاراکتر باشد.';
    if (body.trim().length < 10) errors.body = 'شرح درخواست حداقل ۱۰ کاراکتر باشد.';
    if (body.trim().length > 5000) errors.body = 'شرح درخواست حداکثر ۵۰۰۰ کاراکتر است.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    createMutation.mutate();
  }

  function submitReply() {
    const len = replyText.trim().length;
    if (len < 1 || len > 5000) {
      pushToast('error', 'متن پاسخ باید بین ۱ تا ۵۰۰۰ کاراکتر باشد.');
      return;
    }
    replyMutation.mutate();
  }

  const messages = thread.data?.messages ?? [];
  const isClosed = openTicket?.status === 'CLOSED' || thread.data?.ticket?.status === 'CLOSED';

  return (
    <>
      <PageHeader
        title="پشتیبانی"
        description="پیگیری درخواست‌ها و گفت‌وگو با تیم پشتیبانی"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            تیکت جدید
          </Button>
        }
      />

      <div className="space-y-4">
        {list.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="هنوز تیکتی ثبت نکرده‌اید"
            description="برای سؤالات مالی، فنی یا پیشنهادهایتان تیکت بزنید؛ پاسخ در همین صفحه اطلاع داده می‌شود."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden="true" className="size-4" />
                تیکت جدید
              </Button>
            }
          />
        ) : (
          <>
            <Table caption="فهرست تیکت‌ها">
              <THead>
                <TR>
                  <TH>موضوع</TH>
                  <TH>دسته</TH>
                  <TH>وضعیت</TH>
                  <TH>آخرین بروزرسانی</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {list.items.map((ticket) => (
                  <TR key={String(ticket.id)}>
                    <TD className="max-w-64 truncate font-medium text-neutral-900">{ticket.subject || '—'}</TD>
                    <TD>{CATEGORY_LABELS[ticket.category ?? ''] ?? ticket.category}</TD>
                    <TD>
                      <Badge tone={STATUS_TONES[ticket.status ?? ''] ?? 'neutral'}>
                        {STATUS_LABELS[ticket.status ?? ''] ?? ticket.status}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDateTime(ticket.updatedAt)}</TD>
                    <TD>
                      <Button size="sm" variant="secondary" onClick={() => setOpenTicket(ticket)}>
                        مشاهده گفت‌وگو
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination className="mt-4" page={list.page} totalPages={list.totalPages} onChange={list.setPage} />
          </>
        )}
      </div>

      {/* ------------------------------ create dialog ------------------------------ */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="ثبت تیکت جدید"
        description="پاسخ در همین صفحه و اعلان حساب به شما اطلاع داده می‌شود."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitTicket();
          }}
        >
          <Input
            label="موضوع"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            error={fieldErrors.subject}
            placeholder="خلاصهٔ درخواست"
          />
          <Select label="دسته" value={category} onChange={(e) => setCategory(e.target.value)} required>
            <option value="GENERAL">عمومی</option>
            <option value="BILLING">مالی</option>
            <option value="TECHNICAL">فنی</option>
            <option value="FEATURE">پیشنهاد</option>
          </Select>
          <Textarea
            label="شرح درخواست"
            required
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={fieldErrors.body}
            hint={`${toFa(body.length)} از ۵۰۰۰ کاراکتر`}
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={createMutation.isPending}>
              ثبت تیکت
            </Button>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              انصراف
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ------------------------------ thread dialog ------------------------------ */}
      <Dialog
        open={openTicket !== null}
        onClose={() => setOpenTicket(null)}
        title={thread.data?.ticket?.subject || openTicket?.subject || 'گفت‌وگوی تیکت'}
        description={`تیکت #${toFa(String(openTicket?.id ?? ''))} · ${
          STATUS_LABELS[(thread.data?.ticket?.status ?? openTicket?.status) ?? ''] ?? '—'
        }`}
        size="lg"
      >
        {thread.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : thread.error ? (
          <ErrorCard message={errorMessage(thread.error)} onRetry={() => void thread.refetch()} />
        ) : (
          <div className="space-y-4">
            <ul className="space-y-3">
              {messages.map((message) => {
                const staff = message.isStaff === true;
                return (
                  <li
                    key={String(message.id)}
                    className={
                      'rounded-2xl border px-4 py-3 text-sm leading-6 ' +
                      (staff ? 'border-primary-200 bg-primary-50/60' : 'border-neutral-200 bg-neutral-50')
                    }
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={staff ? 'font-bold text-primary-800' : 'font-bold text-neutral-700'}>
                        {staff ? 'پشتیبانی' : 'شما'}
                      </span>
                      <time className="text-neutral-400" dateTime={message.createdAt}>
                        {faDateTime(message.createdAt)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-neutral-800">{message.body}</p>
                    {message.attachment ? (
                      <p className="mt-2 text-xs text-neutral-500">پیوست: {message.attachment.originalName}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {isClosed ? (
              <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-500">
                این تیکت بسته شده است؛ برای موضوع جدید تیکت تازه‌ای ثبت کنید.
              </p>
            ) : (
              <div className="space-y-3 border-t border-neutral-100 pt-4">
                <Textarea
                  label="پاسخ شما"
                  rows={3}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  hint={`${toFa(replyText.length)} از ۵۰۰۰ کاراکتر`}
                />
                <Button
                  loading={replyMutation.isPending}
                  disabled={replyMutation.isPending}
                  onClick={submitReply}
                >
                  <Send aria-hidden="true" className="size-4" />
                  ارسال پاسخ
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
