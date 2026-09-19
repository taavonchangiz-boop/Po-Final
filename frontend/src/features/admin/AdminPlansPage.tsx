import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Pencil } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get, patch, ApiError } from '../../lib/api';
import { toEn, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { planPrice } from './adminParts';

/**
 * Admin plans — list + edit. Verified against app/src/modules/admin/admin.routes.ts
 * + admin.service.ts + db/seed.ts:
 *  - GET /admin/plans → { items: PlanRow[] } with { id, code (FREE|BASIC|PRO|
 *    BUSINESS|ORG), name, description, priceMonthly, limits { channels,
 *    postsPerMonth, aiCredits, bots, schedules, storageMb }, isActive, sortOrder }.
 *  - PATCH /admin/plans/:id { name?, description?, priceMonthly?, isActive?,
 *    sortOrder?, limits? } → { plan }.
 */

interface PlanLimitsRecord {
  channels?: number;
  postsPerMonth?: number;
  aiCredits?: number;
  bots?: number;
  schedules?: number;
  storageMb?: number;
}

interface AdminPlanRecord {
  id: number | string;
  code?: string;
  name?: string;
  description?: string | null;
  priceMonthly?: number;
  limits?: PlanLimitsRecord;
  isActive?: boolean;
  sortOrder?: number;
}

const LIMIT_FIELDS: ReadonlyArray<{ key: keyof PlanLimitsRecord; label: string }> = [
  { key: 'channels', label: 'کانال' },
  { key: 'postsPerMonth', label: 'پست در ماه' },
  { key: 'aiCredits', label: 'اعتبار هوش مصنوعی' },
  { key: 'bots', label: 'ربات' },
  { key: 'schedules', label: 'زمان‌بندی فعال' },
  { key: 'storageMb', label: 'فضای ذخیره‌سازی (مگابایت)' },
];

export default function AdminPlansPage() {
  usePageTitle('مدیریت پلن‌ها');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const plans = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => get<{ items?: AdminPlanRecord[] }>('/admin/plans'),
  });

  const [editing, setEditing] = useState<AdminPlanRecord | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [limitValues, setLimitValues] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  function openEdit(plan: AdminPlanRecord) {
    setEditing(plan);
    setName(plan.name ?? '');
    setPrice(plan.priceMonthly !== undefined ? String(plan.priceMonthly) : '');
    setLimitValues(
      Object.fromEntries(LIMIT_FIELDS.map(({ key }) => [key, String(plan.limits?.[key] ?? 0)])),
    );
    setIsActive(plan.isActive ?? true);
    setFormError(null);
  }

  const updateMutation = useMutation({
    mutationFn: (input: { id: number | string; body: Record<string, unknown> }) =>
      patch<{ plan?: AdminPlanRecord }>(`/admin/plans/${String(input.id)}`, input.body),
    onSuccess: () => {
      pushToast('success', 'پلن با موفقیت بروزرسانی شد.');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitEdit() {
    setFormError(null);
    if (!editing) return;
    const priceValue = Number(toEn(price).replace(/[^\d]/g, ''));
    if (!Number.isInteger(priceValue) || priceValue < 0) {
      setFormError('قیمت ماهانه باید عددی نامنفی (ریال) باشد.');
      return;
    }
    const limits: Record<string, number> = {};
    for (const { key } of LIMIT_FIELDS) {
      const raw = Number(toEn(limitValues[key] ?? '0').replace(/[^\d]/g, ''));
      if (!Number.isInteger(raw) || raw < 0) {
        setFormError('مقادیر سقف باید اعداد صحیح نامنفی باشند.');
        return;
      }
      limits[key] = raw;
    }
    if (name.trim().length < 1 || name.trim().length > 100) {
      setFormError('نام پلن بین ۱ تا ۱۰۰ کاراکتر باشد.');
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      body: { name: name.trim(), priceMonthly: priceValue, isActive, limits },
    });
  }

  const items = plans.data?.items ?? [];

  return (
    <>
      <PageHeader title="پلن‌ها" description="قیمت و سقف پلن‌های اشتراک" />

      {plans.isLoading ? (
        <Card>
          <CardBody className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardBody>
        </Card>
      ) : plans.error ? (
        <ErrorCard message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="پلنی ثبت نشده است"
          description="پلن‌ها با اجرای seed اولیه ساخته می‌شوند."
        />
      ) : (
        <Table caption="فهرست پلن‌ها">
          <THead>
            <TR>
              <TH>کد</TH>
              <TH>نام</TH>
              <TH>قیمت ماهانه</TH>
              <TH>سقف‌ها</TH>
              <TH>وضعیت</TH>
              <TH>عملیات</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((plan) => (
              <TR key={String(plan.id)}>
                <TD dir="ltr" className="text-xs font-medium text-neutral-500">
                  {plan.code || '—'}
                </TD>
                <TD className="font-medium text-neutral-900">{plan.name || '—'}</TD>
                <TD>{planPrice(plan.priceMonthly)}</TD>
                <TD>
                  <span className="block text-xs leading-5 text-neutral-500">
                    {toFa(plan.limits?.channels ?? 0)} کانال · {toFa(plan.limits?.postsPerMonth ?? 0)} پست/ماه ·{' '}
                    {toFa(plan.limits?.aiCredits ?? 0)} اعتبار · {toFa(plan.limits?.bots ?? 0)} ربات
                  </span>
                </TD>
                <TD>
                  <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                    {plan.isActive ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </TD>
                <TD>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(plan)}>
                    <Pencil aria-hidden="true" className="size-4" />
                    ویرایش
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* edit dialog */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="ویرایش پلن"
        description={editing ? `کد پلن: ${editing.code ?? '—'}` : undefined}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="نام پلن" required value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              label="قیمت ماهانه (ریال)"
              dir="ltr"
              inputMode="numeric"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              hint="۰ = پلن رایگان (بدون پرداخت فعال می‌شود)."
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-neutral-700">سقف‌ها</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {LIMIT_FIELDS.map(({ key, label }) => (
                <Input
                  key={key}
                  label={label}
                  dir="ltr"
                  inputMode="numeric"
                  value={limitValues[key] ?? '0'}
                  onChange={(e) => setLimitValues((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="focus-ring size-4 rounded border-neutral-300 accent-teal-700"
            />
            پلن در فروش و انتخاب کاربران فعال باشد
          </label>
          {formError && (
            <p role="alert" className="text-xs text-red-600">
              {formError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button loading={updateMutation.isPending} onClick={submitEdit}>
              ذخیره
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={updateMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
