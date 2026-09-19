import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, LifeBuoy, Paperclip, Plus, Send, X } from 'lucide-react';
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
import { faDateTime, faNumber, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Support — user tickets: list, create, thread dialog, reply + file attachments.
 * Shapes verified against app/src/modules/support/support.routes.ts + service:
 *  - GET /support/tickets?page&limit → { items: [{ id, userId, subject, category,
 *    status, createdAt, updatedAt }], total, page, limit }.
 *  - POST /support/tickets — JSON { subject (3..190), category (GENERAL|BILLING|
 *    TECHNICAL|FEATURE), body (10..5000) } OR multipart with the same fields +
 *    optional `attachment` file (image/jpeg|png|webp|gif|application/pdf, ≤5MB)
 *    → 201 { ticket }.
 *  - GET /support/tickets/:id → { ticket, messages: [{ id, ticketId, senderUserId,
 *    isStaff, body, attachmentId, createdAt, attachment: { id, originalName,
 *    mime, size } | null }] } (ascending).
 *  - POST /support/tickets/:id/messages { body } or multipart + attachment →
 *    { ticket, message } — user reply flips status to OPEN, staff reply to
 *    ANSWERED; replies to a CLOSED ticket are rejected server-side.
 *  - GET /support/attachments/:id → authorized download (ticket owner or staff).
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
  attachment?: { id: number; originalName: string; mime: string; size: number } | null;
}

/* ------------------------------- attachments ------------------------------- */

const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // mirrors TICKET_ATTACHMENT_MAX_BYTES
const ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const ATTACHMENT_ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,.gif,.pdf';

/** Persian size/type validation mirroring MediaService.saveTicketAttachment. */
function validateAttachment(file: File | null): string | null {
  if (file === null) return null;
  if (!ATTACHMENT_TYPES.has(file.type)) {
    return 'فقط تصاویر JPEG، PNG، WebP، GIF و فایل‌های PDF به‌عنوان پیوست پذیرفته می‌شوند.';
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return 'حجم فایل پیوست بیش از ۵ مگابایت است.';
  }
  return null;
}

function faFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${faNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} مگابایت`;
  return `${faNumber(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

function readCookieValue(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const raw = part.trim();
    if (raw.startsWith(prefix)) return decodeURIComponent(raw.slice(prefix.length));
  }
  return null;
}

type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; requestId?: string } };

/** Multipart POST with the CSRF double-submit header (same envelope as lib/api). */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const csrf = readCookieValue('py_csrf');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: 'POST', headers, credentials: 'include', body: form });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.', 0, 'NETWORK_ERROR');
  }
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await res.json()) as ApiEnvelope<T> | null;
  } catch {
    envelope = null;
  }
  if (!res.ok || !envelope || envelope.success !== true) {
    const err = envelope && envelope.success === false ? envelope.error : undefined;
    if (res.status === 401) window.dispatchEvent(new CustomEvent('postyar:unauthorized'));
    throw new ApiError(err?.message ?? 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.', res.status, err?.code ?? 'INTERNAL_ERROR');
  }
  return envelope.data;
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

  const createFileRef = useRef<HTMLInputElement | null>(null);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [createFileError, setCreateFileError] = useState<string | null>(null);
  const replyFileRef = useRef<HTMLInputElement | null>(null);
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [replyFileError, setReplyFileError] = useState<string | null>(null);

  function pickFile(file: File | null, setFile: (f: File | null) => void, setError: (e: string | null) => void) {
    const err = validateAttachment(file);
    setError(err);
    setFile(err === null ? file : null);
  }

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
    mutationFn: () => {
      if (createFile === null) {
        return post<{ ticket?: TicketRecord }>('/support/tickets', {
          subject: subject.trim(),
          category,
          body: body.trim(),
        });
      }
      const form = new FormData();
      form.append('subject', subject.trim());
      form.append('category', category);
      form.append('body', body.trim());
      form.append('attachment', createFile);
      return postForm<{ ticket?: TicketRecord }>('/support/tickets', form);
    },
    onSuccess: () => {
      pushToast('success', 'تیکت شما ثبت شد؛ کارشناسان ما به‌زودی پاسخ می‌دهند.');
      setCreateOpen(false);
      setSubject('');
      setCategory('GENERAL');
      setBody('');
      setCreateFile(null);
      setCreateFileError(null);
      if (createFileRef.current) createFileRef.current.value = '';
      invalidateTickets();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const replyMutation = useMutation({
    mutationFn: () => {
      if (replyFile === null) {
        return post<{ ticket?: TicketRecord; message?: TicketMessageRecord }>(
          `/support/tickets/${String(openTicket?.id)}/messages`,
          { body: replyText.trim() },
        );
      }
      const form = new FormData();
      form.append('body', replyText.trim());
      form.append('attachment', replyFile);
      return postForm<{ ticket?: TicketRecord; message?: TicketMessageRecord }>(
        `/support/tickets/${String(openTicket?.id)}/messages`,
        form,
      );
    },
    onSuccess: () => {
      pushToast('success', 'پاسخ شما ثبت شد.');
      setReplyText('');
      setReplyFile(null);
      setReplyFileError(null);
      if (replyFileRef.current) replyFileRef.current.value = '';
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
    const fileErr = validateAttachment(createFile);
    if (fileErr !== null) errors.attachment = fileErr;
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
    const fileErr = validateAttachment(replyFile);
    if (fileErr !== null) {
      setReplyFileError(fileErr);
      pushToast('error', fileErr);
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
          <input
            ref={createFileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT_ATTR}
            className="hidden"
            aria-label="انتخاب فایل پیوست"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null, setCreateFile, setCreateFileError)}
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => createFileRef.current?.click()}>
                <Paperclip aria-hidden="true" className="size-4" />
                پیوست فایل
              </Button>
              <span className="text-xs text-neutral-400">تصویر یا PDF · حداکثر ۵ مگابایت</span>
            </div>
            {createFile !== null ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-primary-700" />
                  <span className="truncate font-medium text-neutral-800">{createFile.name}</span>
                  <span className="shrink-0 text-neutral-400">{faFileSize(createFile.size)}</span>
                </span>
                <button
                  type="button"
                  aria-label="حذف پیوست"
                  className="focus-ring rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                  onClick={() => {
                    setCreateFile(null);
                    setCreateFileError(null);
                    if (createFileRef.current) createFileRef.current.value = '';
                  }}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            ) : null}
            {(createFileError ?? fieldErrors.attachment) ? (
              <p className="text-xs font-medium text-red-600">{createFileError ?? fieldErrors.attachment}</p>
            ) : null}
          </div>
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
                      <a
                        href={`/api/v1/support/attachments/${String(message.attachment.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring mt-2.5 inline-flex max-w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-300 hover:text-primary-800"
                        title="دانلود پیوست"
                      >
                        <Download aria-hidden="true" className="size-3.5 shrink-0 text-primary-700" />
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
                <input
                  ref={replyFileRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT_ATTR}
                  className="hidden"
                  aria-label="انتخاب فایل پیوست پاسخ"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null, setReplyFile, setReplyFileError)}
                />
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => replyFileRef.current?.click()}>
                      <Paperclip aria-hidden="true" className="size-4" />
                      پیوست فایل
                    </Button>
                    <span className="text-xs text-neutral-400">تصویر یا PDF · حداکثر ۵ مگابایت</span>
                  </div>
                  {replyFile !== null ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText aria-hidden="true" className="size-4 shrink-0 text-primary-700" />
                        <span className="truncate font-medium text-neutral-800">{replyFile.name}</span>
                        <span className="shrink-0 text-neutral-400">{faFileSize(replyFile.size)}</span>
                      </span>
                      <button
                        type="button"
                        aria-label="حذف پیوست"
                        className="focus-ring rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                        onClick={() => {
                          setReplyFile(null);
                          setReplyFileError(null);
                          if (replyFileRef.current) replyFileRef.current.value = '';
                        }}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  ) : null}
                  {replyFileError ? <p className="text-xs font-medium text-red-600">{replyFileError}</p> : null}
                </div>
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
