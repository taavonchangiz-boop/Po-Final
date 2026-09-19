import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Coins, Pencil, Send, Zap } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, put, ApiError } from '../../lib/api';
import { faMoney, faDateTime, toEn, toFa, providerLabels, labelOf } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Gold — manual price entries + per-channel publishing configs (contract §Gold).
 * Shapes verified against app/src/modules/gold/gold.routes.ts + gold.service.ts:
 *  - GET /gold/prices → { items: [{ asset, price, source, recordedAt }] }
 *    (only assets that already have a recorded price, canonical order).
 *  - POST /gold/prices { asset, price (int > 0) } → 201 row.
 *  - GET /gold/configs → { items: [{ id, channelId, channelTitle, channelProvider,
 *    assets[], frequency, timeOfDay, timezone, template, isEnabled, lastSentAt, ... }] }.
 *  - PUT /gold/configs/:channelId { assets (1..8), frequency, timeOfDay?, timezone
 *    (default Asia/Tehran), template?, isEnabled } — channel must be ACTIVE.
 *  - POST /gold/publish { channelId } → { sent, configId } (idempotent per day).
 */

const GOLD_ASSETS = ['GOLD_18K', 'GOLD_24K', 'COIN_EMAMI', 'COIN_HALF', 'COIN_QUARTER', 'SILVER', 'USD', 'EUR'] as const;
type GoldAsset = (typeof GOLD_ASSETS)[number];
type GoldFrequency = 'MANUAL' | 'HOURLY' | 'DAILY' | 'WEEKLY';

const ASSET_LABELS: Record<GoldAsset, string> = {
  GOLD_18K: 'طلای ۱۸ عیار',
  GOLD_24K: 'طلای ۲۴ عیار',
  COIN_EMAMI: 'سکه امامی',
  COIN_HALF: 'نیم‌سکه',
  COIN_QUARTER: 'ربع‌سکه',
  SILVER: 'نقره',
  USD: 'دلار',
  EUR: 'یورو',
};

const FREQUENCY_LABELS: Record<GoldFrequency, string> = {
  MANUAL: 'دستی',
  HOURLY: 'ساعتی',
  DAILY: 'روزانه',
  WEEKLY: 'هفتگی',
};

const DEFAULT_TEMPLATE = '🪙 نرخ طلای امروز\n{assets_table}\n📅 {date}\nارسال‌شده از پُستیار';

interface GoldPricePoint {
  asset?: GoldAsset | string;
  price?: number;
  source?: 'MANUAL' | 'API' | string;
  recordedAt?: string;
}

interface GoldConfigRecord {
  id: number | string;
  channelId?: number;
  channelTitle?: string;
  channelProvider?: string;
  assets?: string[];
  frequency?: GoldFrequency | string;
  timeOfDay?: string | null;
  timezone?: string;
  template?: string | null;
  isEnabled?: boolean;
  lastSentAt?: string | null;
}

interface ChannelLite {
  id: number | string;
  title?: string;
  status?: string;
  provider?: string;
}

function assetChip(asset: string): string {
  return ASSET_LABELS[asset as GoldAsset] ?? asset;
}

export default function GoldPage() {
  usePageTitle('نرخ طلا و ارسال خودکار');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['gold', 'prices'] });
    void queryClient.invalidateQueries({ queryKey: ['gold', 'configs'] });
  };

  /* --------------------------------- prices --------------------------------- */
  const prices = useQuery({
    queryKey: ['gold', 'prices'],
    queryFn: () => get<{ items?: GoldPricePoint[] }>('/gold/prices'),
  });

  const latestByAsset = new Map<string, GoldPricePoint>();
  for (const point of prices.data?.items ?? []) {
    if (point.asset) latestByAsset.set(String(point.asset), point);
  }

  const [editingAsset, setEditingAsset] = useState<GoldAsset | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingError, setEditingError] = useState<string | null>(null);

  const savePriceMutation = useMutation({
    mutationFn: (input: { asset: GoldAsset; price: number }) =>
      post<{ asset?: string; price?: number }>('/gold/prices', input),
    onSuccess: () => {
      pushToast('success', 'قیمت با موفقیت ثبت شد.');
      setEditingAsset(null);
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitPrice() {
    setEditingError(null);
    if (editingAsset === null) return;
    const raw = toEn(editingValue).replace(/[^\d]/g, '');
    const price = Number(raw);
    if (!Number.isInteger(price) || price <= 0) {
      setEditingError('قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد (به ریال).');
      return;
    }
    savePriceMutation.mutate({ asset: editingAsset, price });
  }

  /* --------------------------------- configs -------------------------------- */
  const configs = useQuery({
    queryKey: ['gold', 'configs'],
    queryFn: () => get<{ items?: GoldConfigRecord[] }>('/gold/configs'),
  });

  const activeChannels = useQuery({
    queryKey: ['gold', 'activeChannels'],
    queryFn: () => get<{ items?: ChannelLite[] }>('/channels?limit=100&status=ACTIVE'),
  });

  const channelOptions = (activeChannels.data?.items ?? []).filter((c) => c.status === 'ACTIVE');

  const [configOpen, setConfigOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<GoldConfigRecord | null>(null);
  const [cfgChannelId, setCfgChannelId] = useState('');
  const [cfgAssets, setCfgAssets] = useState<string[]>([]);
  const [cfgFrequency, setCfgFrequency] = useState<GoldFrequency>('DAILY');
  const [cfgTime, setCfgTime] = useState('09:00');
  const [cfgTemplate, setCfgTemplate] = useState('');
  const [cfgEnabled, setCfgEnabled] = useState(true);
  const [cfgError, setCfgError] = useState<string | null>(null);

  function openNewConfig() {
    setEditingConfig(null);
    setCfgChannelId(channelOptions[0] ? String(channelOptions[0]!.id) : '');
    setCfgAssets(['GOLD_18K']);
    setCfgFrequency('DAILY');
    setCfgTime('09:00');
    setCfgTemplate('');
    setCfgEnabled(true);
    setCfgError(null);
    setConfigOpen(true);
  }

  function openEditConfig(config: GoldConfigRecord) {
    setEditingConfig(config);
    setCfgChannelId(String(config.channelId ?? ''));
    setCfgAssets(config.assets ?? []);
    setCfgFrequency((config.frequency as GoldFrequency) ?? 'DAILY');
    setCfgTime(config.timeOfDay ?? '09:00');
    setCfgTemplate(config.template ?? '');
    setCfgEnabled(config.isEnabled ?? true);
    setCfgError(null);
    setConfigOpen(true);
  }

  const saveConfigMutation = useMutation({
    mutationFn: (channelId: string) =>
      put<GoldConfigRecord>(`/gold/configs/${channelId}`, {
        assets: cfgAssets,
        frequency: cfgFrequency,
        ...(cfgFrequency !== 'MANUAL' && cfgFrequency !== 'HOURLY' && cfgTime ? { timeOfDay: cfgTime } : {}),
        timezone: 'Asia/Tehran',
        ...(cfgTemplate.trim() ? { template: cfgTemplate.trim() } : {}),
        isEnabled: cfgEnabled,
      }),
    onSuccess: () => {
      pushToast('success', 'تنظیمات انتشار نرخ طلا ذخیره شد.');
      setConfigOpen(false);
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitConfig() {
    setCfgError(null);
    if (!cfgChannelId) {
      setCfgError('یک کانال فعال انتخاب کنید.');
      return;
    }
    if (cfgAssets.length < 1) {
      setCfgError('حداقل یک دارایی را انتخاب کنید.');
      return;
    }
    if (cfgAssets.length > 8) {
      setCfgError('حداکثر ۸ دارایی قابل انتخاب است.');
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfgTime)) {
      setCfgError('ساعت باید با قالب ۰۰:۰۰ تا ۲۳:۵۹ باشد.');
      return;
    }
    if (cfgTemplate.length > 2000) {
      setCfgError('قالب پیام حداکثر ۲۰۰۰ کاراکتر است.');
      return;
    }
    saveConfigMutation.mutate(cfgChannelId);
  }

  const publishMutation = useMutation({
    mutationFn: (channelId: number) =>
      post<{ sent?: boolean; configId?: number }>('/gold/publish', { channelId }),
    onSuccess: (data) => {
      if (data?.sent) {
        pushToast('success', 'پیام نرخ طلا به صف ارسال اضافه شد.');
      } else {
        pushToast('info', 'درخواست ارسال ثبت شد اما صف پردازش در دسترس نیست؛ بعداً تلاش کنید.');
      }
      void queryClient.invalidateQueries({ queryKey: ['gold', 'configs'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  /* --------------------------------- render --------------------------------- */
  const configsList = configs.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="نرخ طلا"
        description="ثبت دستی نرخ‌ها و انتشار خودکار در کانال‌ها"
        actions={
          <Button onClick={openNewConfig} disabled={channelOptions.length === 0}>
            <Pencil aria-hidden="true" className="size-4" />
            تنظیم انتشار برای کانال
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ------------------------------ prices editor ------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins aria-hidden="true" className="size-4 text-primary-700" />
              نرخ‌های روز
            </CardTitle>
          </CardHeader>
          <CardBody>
            {prices.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : prices.error ? (
              <ErrorCard message={errorMessage(prices.error)} onRetry={() => void prices.refetch()} />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {GOLD_ASSETS.map((asset) => {
                  const point = latestByAsset.get(asset);
                  const isEditing = editingAsset === asset;
                  return (
                    <li key={asset} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">{ASSET_LABELS[asset]}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {point?.recordedAt ? `به‌روزرسانی: ${faDateTime(point.recordedAt)}` : 'قیمتی ثبت نشده است'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-neutral-900">
                          {typeof point?.price === 'number' ? faMoney(point.price) : '—'}
                        </span>
                        {isEditing ? (
                          <span className="flex items-center gap-2">
                            <Input
                              dir="ltr"
                              className="w-40"
                              inputMode="numeric"
                              aria-label={`${ASSET_LABELS[asset]} — قیمت جدید به ریال`}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              error={editingError ?? undefined}
                              placeholder="قیمت به ریال"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              loading={savePriceMutation.isPending}
                              onClick={submitPrice}
                              aria-label="ذخیره قیمت"
                            >
                              <Check aria-hidden="true" className="size-4" />
                              ذخیره
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditingAsset(null); setEditingError(null); }}>
                              انصراف
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingAsset(asset);
                              setEditingValue(point?.price !== undefined ? String(point.price) : '');
                              setEditingError(null);
                            }}
                          >
                            ویرایش
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* -------------------------------- configs card ------------------------------ */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-neutral-900">تنظیمات انتشار خودکار</h2>
          {configs.isLoading ? (
            <Card>
              <CardBody className="space-y-3">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </CardBody>
            </Card>
          ) : configs.error ? (
            <ErrorCard message={errorMessage(configs.error)} onRetry={() => void configs.refetch()} />
          ) : configsList.length === 0 ? (
            <EmptyState
              icon={Send}
              title="برای هیچ کانالی تنظیم نشده است"
              description={
                channelOptions.length === 0
                  ? 'ابتدا از بخش کانال‌ها یک کانال فعال بسازید؛ سپس می‌توانید انتشار نرخ طلا را تنظیم کنید.'
                  : 'با زدن دکمهٔ «تنظیم انتشار برای کانال»، ارسال خودکار یا دستی نرخ‌ها را فعال کنید.'
              }
              action={
                channelOptions.length > 0 ? (
                  <Button onClick={openNewConfig}>
                    <Pencil aria-hidden="true" className="size-4" />
                    تنظیم انتشار برای کانال
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {configsList.map((config) => (
                <Card key={String(config.id)}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-neutral-900">{config.channelTitle || `کانال #${toFa(String(config.channelId ?? ''))}`}</p>
                        <Badge tone="info">{labelOf(providerLabels, config.channelProvider)}</Badge>
                      </div>
                      <Badge tone={config.isEnabled ? 'success' : 'neutral'}>
                        {config.isEnabled ? 'فعال' : 'غیرفعال'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(config.assets ?? []).map((asset) => (
                        <span key={asset} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-700">
                          {assetChip(asset)}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-neutral-500">
                      تناوب: {FREQUENCY_LABELS[(config.frequency as GoldFrequency) ?? 'MANUAL'] ?? String(config.frequency)}
                      {config.timeOfDay ? ` · ساعت ${toFa(config.timeOfDay)}` : ''}
                      {config.lastSentAt ? ` · آخرین ارسال: ${faDateTime(config.lastSentAt)}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button size="sm" variant="secondary" onClick={() => openEditConfig(config)}>
                        <Pencil aria-hidden="true" className="size-4" />
                        ویرایش
                      </Button>
                      <Button
                        size="sm"
                        loading={publishMutation.isPending && publishMutation.variables === config.channelId}
                        disabled={publishMutation.isPending || typeof config.channelId !== 'number'}
                        onClick={() => {
                          if (typeof config.channelId === 'number') publishMutation.mutate(config.channelId);
                        }}
                      >
                        <Zap aria-hidden="true" className="size-4" />
                        انتشار فوری
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------ config dialog ------------------------------ */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        title={editingConfig ? 'ویرایش تنظیمات انتشار' : 'تنظیم انتشار نرخ طلا'}
        description={
          editingConfig
            ? `کانال: ${editingConfig.channelTitle ?? ''}`
            : 'انتخاب کانال فعال، دارایی‌ها و تناوب ارسال'
        }
        size="lg"
      >
        <div className="space-y-4">
          <Select
            label="کانال"
            value={cfgChannelId}
            onChange={(e) => setCfgChannelId(e.target.value)}
            disabled={editingConfig !== null}
            required
            hint={editingConfig ? 'کانال تنظیم ثبت‌شده قابل تغییر نیست.' : 'فقط کانال‌های فعال نمایش داده می‌شوند.'}
          >
            <option value="" disabled>
              انتخاب کنید
            </option>
            {channelOptions.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {c.title || `کانال #${String(c.id)}`}
              </option>
            ))}
          </Select>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-neutral-700">
              دارایی‌ها <span className="text-red-600">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-200 p-3 sm:grid-cols-4">
              {GOLD_ASSETS.map((asset) => (
                <label key={asset} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={cfgAssets.includes(asset)}
                    onChange={(e) => {
                      setCfgAssets((prev) =>
                        e.target.checked ? [...prev, asset] : prev.filter((a) => a !== asset),
                      );
                    }}
                    className="focus-ring size-4 rounded border-neutral-300 accent-teal-700"
                  />
                  {ASSET_LABELS[asset]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="تناوب ارسال"
              value={cfgFrequency}
              onChange={(e) => setCfgFrequency(e.target.value as GoldFrequency)}
              required
            >
              <option value="MANUAL">دستی</option>
              <option value="HOURLY">ساعتی</option>
              <option value="DAILY">روزانه</option>
              <option value="WEEKLY">هفتگی</option>
            </Select>
            <Input
              label="ساعت ارسال"
              dir="ltr"
              type="time"
              value={cfgTime}
              onChange={(e) => setCfgTime(e.target.value)}
              hint="به وقت تهران؛ برای تناوب روزانه و هفتگی اعمال می‌شود."
            />
          </div>

          <Textarea
            label="قالب پیام"
            rows={4}
            value={cfgTemplate}
            onChange={(e) => setCfgTemplate(e.target.value)}
            placeholder={DEFAULT_TEMPLATE}
            hint="متغیرها: {assets_table} و {date} — در صورت خالی‌بودن، قالب پیش‌فرض استفاده می‌شود."
          />

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={cfgEnabled}
              onChange={(e) => setCfgEnabled(e.target.checked)}
              className="focus-ring size-4 rounded border-neutral-300 accent-teal-700"
            />
            انتشار خودکار فعال باشد
          </label>

          {cfgError && (
            <p role="alert" className="text-xs text-red-600">
              {cfgError}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button loading={saveConfigMutation.isPending} onClick={submitConfig}>
              ذخیره تنظیمات
            </Button>
            <Button variant="ghost" onClick={() => setConfigOpen(false)} disabled={saveConfigMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
