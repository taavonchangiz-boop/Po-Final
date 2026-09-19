import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot as BotIcon,
  CircleCheck,
  Clock,
  RefreshCw,
  Server,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { Stat } from '../../components/ui/Stat';
import { EmptyState } from '../../components/ui/EmptyState';
import { FullPageSpinner } from '../../components/ui/Spinner';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post } from '../../lib/api';
import { faDate, faDateTime, labelOf, providerLabels } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { ErrorCard } from './botUi';
import {
  botStatusLabels,
  errorMessage,
  webhookStateLabels,
  type BotRecord,
} from './botTypes';
import { CommandsTab } from './CommandsTab';
import { WorkflowsTab } from './WorkflowsTab';
import { EventsTab } from './EventsTab';
import { UsersTab } from './UsersTab';
import { AiTab } from './AiTab';

/**
 * Bot detail (task 4-d-1) — route /app/bots/:id.
 * GET /bots/:id → { bot: serializeBot() } (bots.routes.ts). Tabs: overview,
 * commands, workflows (builder + runs), events, users, AI config.
 * Active tab is mirrored into ?tab= so WorkflowsPage «ویرایش» deep-links here.
 */

interface BotResponse {
  bot?: BotRecord;
}

const TAB_KEYS = ['overview', 'commands', 'workflows', 'events', 'users', 'ai'] as const;

const TAB_ITEMS = [
  { key: 'overview', label: 'نمای کلی' },
  { key: 'commands', label: 'دستورها' },
  { key: 'workflows', label: 'گردش‌کارها' },
  { key: 'events', label: 'رویدادها' },
  { key: 'users', label: 'کاربران' },
  { key: 'ai', label: 'هوش مصنوعی' },
] as const;

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageTitle('جزئیات ربات');

  const botId = typeof id === 'string' ? id : '';
  const valid = /^\d+$/.test(botId);

  const rawTab = searchParams.get('tab') ?? 'overview';
  const tab = (TAB_KEYS as readonly string[]).includes(rawTab) ? rawTab : 'overview';

  function selectTab(key: string) {
    if (key === 'overview') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: key }, { replace: true });
    }
  }

  const botQuery = useQuery({
    queryKey: ['bot', botId],
    queryFn: () => get<BotResponse>(`/bots/${botId}`),
    enabled: valid,
  });

  const bot = botQuery.data?.bot ?? null;

  usePageTitle(bot?.title || bot?.username || 'جزئیات ربات');

  return (
    <>
      <PageHeader
        title={bot?.title || bot?.username || 'جزئیات ربات'}
        description={
          bot ? `مدیریت ربات ${labelOf(providerLabels, bot.provider)} و امکانات خودکار آن` : undefined
        }
        actions={
          <Link
            to="/app/bots"
            className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowRight aria-hidden="true" className="size-4" />
            بازگشت به ربات‌ها
          </Link>
        }
      />

      {!valid ? (
        <EmptyState
          icon={BotIcon}
          title="ربات یافت نشد"
          description="شناسه ربات معتبر نیست؛ از فهرست ربات‌ها یک ربات را انتخاب کنید."
          action={
            <Link
              to="/app/bots"
              className="focus-ring inline-flex h-10 items-center rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
            >
              فهرست ربات‌ها
            </Link>
          }
        />
      ) : botQuery.isLoading ? (
        <FullPageSpinner label="در حال بارگذاری ربات…" />
      ) : botQuery.error ? (
        <ErrorCard message={errorMessage(botQuery.error)} onRetry={() => void botQuery.refetch()} />
      ) : bot ? (
        <div className="space-y-5">
          <Tabs
            ariaLabel="بخش‌های ربات"
            items={TAB_ITEMS.map((t) => ({ key: t.key, label: t.label }))}
            active={tab}
            onChange={selectTab}
          />

          {tab === 'overview' ? <OverviewTab bot={bot} /> : null}
          {tab === 'commands' ? <CommandsTab botId={botId} bot={bot} /> : null}
          {tab === 'workflows' ? <WorkflowsTab botId={botId} /> : null}
          {tab === 'events' ? <EventsTab botId={botId} /> : null}
          {tab === 'users' ? <UsersTab botId={botId} /> : null}
          {tab === 'ai' ? <AiTab botId={botId} bot={bot} /> : null}
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------- overview -------------------------------- */

function OverviewTab({ bot }: { bot: BotRecord }) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const verifyMutation = useMutation({
    mutationFn: () => post<{ bot?: BotRecord }>(`/bots/${bot.id}/verify`),
    onSuccess: (data) => {
      if (data?.bot?.status === 'ACTIVE') pushToast('success', 'ربات بررسی شد و فعال است.');
      else pushToast('error', data?.bot?.lastError || 'بررسی ربات ناموفق بود.');
      void queryClient.invalidateQueries({ queryKey: ['bot', String(bot.id)] });
      void queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="وضعیت"
          value={labelOf(botStatusLabels, bot.status)}
          icon={bot.status === 'ACTIVE' ? CircleCheck : ShieldAlert}
        />
        <Stat label="سرویس" value={labelOf(providerLabels, bot.provider)} icon={Server} />
        <Stat
          label="آخرین بررسی"
          value={bot.lastVerifiedAt ? faDateTime(bot.lastVerifiedAt) : '—'}
          hint={bot.lastVerifiedAt ? undefined : 'هنوز بررسی نشده'}
          icon={Clock}
        />
        <Stat label="تاریخ اتصال" value={faDate(bot.createdAt) || '—'} icon={BotIcon} />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-neutral-800">وضعیت دریافت پیام</p>
              <p className="mt-1 text-xs text-neutral-500">
                {labelOf(webhookStateLabels, bot.webhookState)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              بررسی سلامت ربات
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
            <Badge state={bot.status} labels={botStatusLabels} />
            {bot.isEnabled ? (
              <Badge tone="success">دریافت پیام روشن</Badge>
            ) : (
              <Badge tone="neutral">دریافت پیام خاموش</Badge>
            )}
            {bot.username ? (
              <span dir="ltr" className="text-xs text-neutral-400">
                @{bot.username.replace(/^@/, '')}
              </span>
            ) : null}
          </div>
          {bot.lastError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              آخرین خطا: {bot.lastError}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
