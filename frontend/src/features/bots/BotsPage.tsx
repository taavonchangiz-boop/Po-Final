import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, PowerOff, Power, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Dialog } from '../../components/ui/Dialog';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { post } from '../../lib/api';
import { faDate, labelOf, providerLabels } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { ErrorCard, PlanLimitBanner } from './botUi';
import {
  botStatusLabels,
  errorMessage,
  planLimitMessage,
  webhookStateLabels,
  type BotRecord,
} from './botTypes';

/**
 * Bots (task 4-d-1) — connect / verify / enable / disable / manage.
 * Backend shapes verified against app/src/modules/bots/bots.routes.ts:
 *  - POST /bots { provider, token, title? } → { bot: serializeBot(), verified }.
 *  - POST /bots/:id/verify|enable|disable → { bot }.
 *  - serializeBot: { id, provider, username, title, isEnabled, status,
 *    webhookState, commands, aiConfig, lastError, lastVerifiedAt, … }.
 * NOTE: the bots plan-limit surfaces as CONFLICT with a «سقف … ارتقا …» message
 * (bots.service.ts) — handled by planLimitMessage() alongside PLAN_LIMIT.
 */

interface BotsListResponse {
  bot?: BotRecord;
  verified?: boolean;
}

const GUIDE_STEPS = [
  '۱) در سرویس موردنظر یک ربات بسازید (BotFather برای تلگرام).',
  '۲) توکن را اینجا وارد کنید.',
];

export default function BotsPage() {
  usePageTitle('ربات‌ها');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [connectOpen, setConnectOpen] = useState(false);
  const [planLimit, setPlanLimit] = useState<string | null>(null);

  // Connect form
  const [provider, setProvider] = useState('TELEGRAM');
  const [token, setToken] = useState('');
  const [title, setTitle] = useState('');

  const bots = usePaged<BotRecord>({
    queryKey: ['bots'],
    buildPath: (page, limit) => `/bots?page=${page}&limit=${limit}`,
  });

  function resetConnectForm() {
    setProvider('TELEGRAM');
    setToken('');
    setTitle('');
  }

  const invalidateBots = () => {
    void queryClient.invalidateQueries({ queryKey: ['bots'] });
  };

  const connectMutation = useMutation({
    mutationFn: () =>
      post<BotsListResponse>('/bots', {
        provider,
        token: token.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      }),
    onSuccess: (data) => {
      const botTitle = data?.bot?.title || data?.bot?.username || '';
      pushToast(
        'success',
        botTitle
          ? `ربات «${botTitle}» با موفقیت متصل شد.`
          : 'ربات با موفقیت متصل و تأیید شد.',
      );
      setConnectOpen(false);
      resetConnectForm();
      invalidateBots();
    },
    onError: (e: unknown) => {
      const pl = planLimitMessage(e);
      if (pl) {
        setPlanLimit(pl);
        pushToast('error', pl);
        setConnectOpen(false);
        return;
      }
      pushToast('error', errorMessage(e));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: number | string) => post<BotsListResponse>(`/bots/${id}/verify`),
    onSuccess: (data) => {
      if (data?.bot?.status === 'ACTIVE') pushToast('success', 'ربات بررسی شد و فعال است.');
      else pushToast('error', data?.bot?.lastError || 'بررسی ربات ناموفق بود.');
      invalidateBots();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, action }: { id: number | string; action: 'enable' | 'disable' }) =>
      post<BotsListResponse>(`/bots/${id}/${action}`),
    onSuccess: (_data, vars) => {
      pushToast('success', vars.action === 'enable' ? 'ربات فعال شد.' : 'ربات غیرفعال شد.');
      invalidateBots();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const isLoading = bots.isLoading;

  return (
    <>
      <PageHeader
        title="ربات‌ها"
        description="اتصال ربات‌های تلگرام و بله و مدیریت آن‌ها"
        actions={
          <Button
            onClick={() => {
              setPlanLimit(null);
              setConnectOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            اتصال ربات
          </Button>
        }
      />

      <div className="space-y-4">
        {planLimit && <PlanLimitBanner message={planLimit} />}

        {isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : bots.error ? (
          <ErrorCard message={errorMessage(bots.error)} onRetry={() => void bots.refetch()} />
        ) : bots.items.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="هنوز رباتی متصل نکرده‌اید"
            description="با اتصال ربات، پاسخ‌گویی خودکار، گردش‌کارها و پاسخ‌های هوش مصنوعی در گروه‌ها و کانال‌های شما فعال می‌شود."
            action={
              <Button
                onClick={() => {
                  setPlanLimit(null);
                  setConnectOpen(true);
                }}
              >
                <Plus aria-hidden="true" className="size-4" />
                اتصال ربات
              </Button>
            }
          />
        ) : (
          <>
            <Table caption="فهرست ربات‌ها">
              <THead>
                <TR>
                  <TH>ربات</TH>
                  <TH>سرویس</TH>
                  <TH>وضعیت</TH>
                  <TH>پاسخ هوشمند</TH>
                  <TH>تاریخ اتصال</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {bots.items.map((bot) => (
                  <TR key={String(bot.id)}>
                    <TD className="font-medium text-neutral-900">
                      {bot.title || bot.username || '—'}
                      {bot.username ? (
                        <span dir="ltr" className="mt-0.5 block text-xs text-neutral-400">
                          @{bot.username.replace(/^@/, '')}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone="info">{labelOf(providerLabels, bot.provider)}</Badge>
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <Badge state={bot.status} labels={botStatusLabels} />
                        <span className="text-xs text-neutral-400">
                          {labelOf(webhookStateLabels, bot.webhookState)}
                        </span>
                        {bot.lastError ? (
                          <span className="max-w-56 truncate text-xs text-red-600" title={bot.lastError}>
                            {bot.lastError}
                          </span>
                        ) : null}
                      </div>
                    </TD>
                    <TD>
                      {bot.aiConfig?.enabled ? (
                        <Badge tone="info">
                          <Sparkles aria-hidden="true" className="me-1 size-3" />
                          پاسخ هوشمند
                        </Badge>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDate(bot.createdAt) || '—'}</TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={verifyMutation.isPending && verifyMutation.variables === bot.id}
                          disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate(bot.id)}
                        >
                          <RefreshCw aria-hidden="true" className="size-4" />
                          بررسی
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={
                            toggleMutation.isPending && toggleMutation.variables?.id === bot.id
                          }
                          disabled={toggleMutation.isPending}
                          onClick={() =>
                            toggleMutation.mutate({
                              id: bot.id,
                              action: bot.isEnabled ? 'disable' : 'enable',
                            })
                          }
                        >
                          {bot.isEnabled ? (
                            <>
                              <PowerOff aria-hidden="true" className="size-4 text-red-600" />
                              غیرفعال
                            </>
                          ) : (
                            <>
                              <Power aria-hidden="true" className="size-4 text-green-700" />
                              فعال
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/app/bots/${bot.id}`)}
                        >
                          <Settings2 aria-hidden="true" className="size-4" />
                          مدیریت
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={bots.page} totalPages={bots.totalPages} onChange={bots.setPage} />
          </>
        )}

        <p className="text-xs text-neutral-400">
          برای مدیریت دستورها، گردش‌کارها و تنظیمات هوش مصنوعی به صفحه «مدیریت» هر ربات بروید؛ نمای کلی در{' '}
          <Link to="/app/workflows" className="text-primary-700 underline-offset-4 hover:underline">
            گردش‌کارها
          </Link>{' '}
          هم در دسترس است.
        </p>
      </div>

      {/* ----------------------------- connect dialog ---------------------------- */}
      <Dialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="اتصال ربات"
        description="ربات شما پس از تأیید توکن، پاسخ‌گویی خودکار را فعال می‌کند."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            connectMutation.mutate();
          }}
        >
          <ol className="space-y-1.5 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm leading-6 text-primary-900">
            {GUIDE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Select label="سرویس" value={provider} onChange={(e) => setProvider(e.target.value)} required>
            <option value="TELEGRAM">تلگرام</option>
            <option value="BALE">بله</option>
            <option value="RUBIKA">روبیکا</option>
          </Select>
          <Input
            label="توکن ربات"
            type="password"
            dir="ltr"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            hint="توکن به‌صورت رمزنگاری‌شده ذخیره می‌شود و هرگز نمایش داده نمی‌شود."
          />
          <Input
            label="عنوان (اختیاری)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="خالی بمانید تا از سرویس‌دهنده گرفته شود"
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={connectMutation.isPending}>
              اتصال ربات
            </Button>
            <Button variant="ghost" onClick={() => setConnectOpen(false)} disabled={connectMutation.isPending}>
              انصراف
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
