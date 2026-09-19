import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare, Plus, RefreshCw, Unplug } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { ApiError, post, del } from '../../lib/api';
import {
  channelStatusLabels,
  faDateTime,
  labelOf,
  providerLabels,
} from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';

/**
 * Channels — list / connect / verify / disconnect (contract §Channels).
 * Backend shapes verified against app/src/modules/channels/channels.routes.ts:
 *  - POST /channels body = { provider, chatId, title, token } (contract doc says
 *    botToken — the real zod schema field is `token`).
 *  - POST /channels/:id/verify → { status: 'ACTIVE'|'ERROR', username?|error? }.
 */

interface ChannelRecord {
  id: number | string;
  provider?: string;
  chatId?: string;
  title?: string;
  username?: string | null;
  status?: string;
  lastError?: string | null;
  lastVerifiedAt?: string | null;
  createdAt?: string;
}

interface CreateChannelResponse {
  id?: number | string;
  status?: string;
  message?: string;
}

interface VerifyChannelResponse {
  status?: string;
  username?: string | null;
  title?: string | null;
  error?: string | null;
}

const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : GENERIC_ERROR;
}

/** PLAN_LIMIT (and the bots-style سقف CONFLICT) → upgrade-plan flow. */
function planLimitMessage(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT') return e.message;
    if (e.code === 'CONFLICT' && e.message.includes('سقف')) return e.message;
  }
  return null;
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-red-200">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-red-700">{message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          تلاش مجدد
        </Button>
      </CardBody>
    </Card>
  );
}

function PlanLimitBanner({ message }: { message: string }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-amber-800">{message}</p>
        <Link
          to="/app/subscription"
          className="focus-ring inline-flex h-8 shrink-0 items-center rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700"
        >
          ارتقای پلن
        </Link>
      </CardBody>
    </Card>
  );
}

const PROVIDER_FILTERS = [
  { key: 'ALL', label: 'همه' },
  { key: 'TELEGRAM', label: 'تلگرام' },
  { key: 'BALE', label: 'بله' },
  { key: 'RUBIKA', label: 'روبیکا' },
] as const;

export default function ChannelsPage() {
  usePageTitle('کانال‌ها');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [addOpen, setAddOpen] = useState(false);
  const [planLimit, setPlanLimit] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<number | string | null>(null);

  const list = usePaged<ChannelRecord>({
    queryKey: ['channels', providerFilter],
    buildPath: (page, limit) => {
      const base = `/channels?page=${page}&limit=${limit}`;
      return providerFilter === 'ALL' ? base : `${base}&provider=${providerFilter}`;
    },
  });

  const disconnectTarget = list.items.find((c) => String(c.id) === String(disconnectId)) ?? null;

  const invalidateChannels = () => {
    void queryClient.invalidateQueries({ queryKey: ['channels'] });
  };

  /* ------------------------------ add channel ------------------------------ */

  const [provider, setProvider] = useState('TELEGRAM');
  const [chatId, setChatId] = useState('');
  const [title, setTitle] = useState('');
  const [token, setToken] = useState('');

  function resetAddForm() {
    setProvider('TELEGRAM');
    setChatId('');
    setTitle('');
    setToken('');
  }

  const createMutation = useMutation({
    mutationFn: () =>
      post<CreateChannelResponse>('/channels', {
        provider,
        chatId: chatId.trim(),
        title: title.trim(),
        token: token.trim(),
      }),
    onSuccess: (data) => {
      pushToast('success', data?.message ?? 'کانال با موفقیت اضافه شد. برای فعال‌سازی، کانال را بررسی کنید.');
      setAddOpen(false);
      resetAddForm();
      invalidateChannels();
    },
    onError: (e: unknown) => {
      const pl = planLimitMessage(e);
      if (pl) {
        setPlanLimit(pl);
        pushToast('error', pl);
        setAddOpen(false);
        return;
      }
      pushToast('error', errorMessage(e));
    },
  });

  /* --------------------------- verify / disconnect -------------------------- */

  const verifyMutation = useMutation({
    mutationFn: (id: number | string) => post<VerifyChannelResponse>(`/channels/${id}/verify`),
    onSuccess: (data) => {
      if (data?.status === 'ACTIVE') {
        pushToast('success', 'کانال با موفقیت تأیید و فعال شد.');
      } else {
        pushToast('error', data?.error || 'بررسی کانال ناموفق بود؛ جزئیات خطا در جدول نمایش داده شده است.');
      }
      invalidateChannels();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: number | string) => del(`/channels/${id}`),
    onSuccess: () => {
      pushToast('success', 'کانال قطع شد.');
      setDisconnectId(null);
      invalidateChannels();
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setDisconnectId(null);
    },
  });

  /* --------------------------------- render -------------------------------- */

  const isLoading = list.isLoading;

  return (
    <>
      <PageHeader
        title="کانال‌ها"
        description="اتصال و مدیریت کانال‌های تلگرام، بله و روبیکا"
        actions={
          <Button
            onClick={() => {
              setPlanLimit(null);
              setAddOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            افزودن کانال
          </Button>
        }
      />

      <div className="space-y-4">
        {planLimit && <PlanLimitBanner message={planLimit} />}

        <Tabs
          ariaLabel="فیلتر سرویس کانال"
          items={PROVIDER_FILTERS.map((f) => ({ key: f.key, label: f.label }))}
          active={providerFilter}
          onChange={setProviderFilter}
        />

        {isLoading ? (
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
            icon={MessagesSquare}
            title="هنوز کانالی متصل نکرده‌اید"
            description="با افزودن کانال، انتشار محتوا را شروع کنید."
            action={
              <Button
                onClick={() => {
                  setPlanLimit(null);
                  setAddOpen(true);
                }}
              >
                <Plus aria-hidden="true" className="size-4" />
                افزودن کانال
              </Button>
            }
          />
        ) : (
          <>
            <Table caption="فهرست کانال‌ها">
              <THead>
                <TR>
                  <TH>عنوان</TH>
                  <TH>سرویس</TH>
                  <TH>شناسه</TH>
                  <TH>وضعیت</TH>
                  <TH>آخرین بررسی</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {list.items.map((ch) => (
                  <TR key={String(ch.id)}>
                    <TD className="font-medium text-neutral-900">
                      {ch.title || '—'}
                      {ch.username ? (
                        <span dir="ltr" className="mt-0.5 block text-xs text-neutral-400">
                          @{ch.username.replace(/^@/, '')}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone="info">{labelOf(providerLabels, ch.provider)}</Badge>
                    </TD>
                    <TD dir="ltr" className="text-xs text-neutral-500">
                      {ch.chatId || '—'}
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <Badge state={ch.status} labels={channelStatusLabels} />
                        {ch.lastError ? (
                          <span className="max-w-56 truncate text-xs text-red-600" title={ch.lastError}>
                            {ch.lastError}
                          </span>
                        ) : null}
                      </div>
                    </TD>
                    <TD className="text-xs text-neutral-500">
                      {ch.lastVerifiedAt ? faDateTime(ch.lastVerifiedAt) : '—'}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={verifyMutation.isPending && verifyMutation.variables === ch.id}
                          disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate(ch.id)}
                        >
                          بررسی
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disconnectMutation.isPending}
                          onClick={() => setDisconnectId(ch.id)}
                        >
                          <Unplug aria-hidden="true" className="size-4 text-red-600" />
                          قطع اتصال
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={list.page} totalPages={list.totalPages} onChange={list.setPage} />
          </>
        )}
      </div>

      {/* ------------------------------ add dialog ------------------------------ */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="افزودن کانال"
        description="کانال باید توسط رباتِ پُست‌یار به‌عنوان مدیر اضافه شده باشد."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <Select
            label="سرویس"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            required
          >
            <option value="TELEGRAM">تلگرام</option>
            <option value="BALE">بله</option>
            <option value="RUBIKA">روبیکا</option>
          </Select>
          <Input
            label="شناسه کانال"
            dir="ltr"
            required
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="@mychannel یا -1001234567890"
            hint="نام کاربری عمومی کانال (با @) یا شناسه عددی کانال خصوصی."
          />
          <Input
            label="عنوان کانال"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً کانال فروشگاه"
          />
          <Input
            label="توکن ربات"
            type="password"
            dir="ltr"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            hint="توکن ربات به‌صورت رمزنگاری‌شده ذخیره می‌شود و هرگز نمایش داده نمی‌شود."
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={createMutation.isPending}>
              افزودن کانال
            </Button>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>
              انصراف
            </Button>
          </div>
        </form>
      </Dialog>

      {/* --------------------------- disconnect confirm -------------------------- */}
      <ConfirmDialog
        open={disconnectId !== null}
        onClose={() => setDisconnectId(null)}
        onConfirm={() => {
          if (disconnectId !== null) disconnectMutation.mutate(disconnectId);
        }}
        loading={disconnectMutation.isPending}
        title="قطع اتصال کانال"
        description={`آیا از قطع اتصال «${disconnectTarget?.title || 'این کانال'}» مطمئن هستید؟ کانال از فهرست هدف انتشار حذف می‌شود و سابقه پست‌ها حفظ خواهد شد.`}
        confirmLabel="بله، قطع کن"
      />
    </>
  );
}
