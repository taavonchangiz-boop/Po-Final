import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading } from '../../components/ui';
import { faDigits, faMoney, toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { errText, type AdminPlanDto } from './shared';

/* ------------------------------------------------------------------ */
/* اشتراک‌ها (پلن‌ها) — full CRUD on subscription plans (Task 16-b).   */
/* ------------------------------------------------------------------ */

interface PlanLimits {
  max_channels: number;
  max_posts: number;
  max_bots: number;
  max_schedules: number;
  ai_monthly: number;
  storage_mb: number;
}

interface PlanFeatures {
  gold_ticker: boolean;
  auto_responder: boolean;
  woocommerce: boolean;
  api_access: boolean;
}

const EMPTY_FORM = {
  code: '',
  nameFa: '',
  priceRial: '',
  periodDays: '',
  limits: { max_channels: '', max_posts: '', max_bots: '', max_schedules: '', ai_monthly: '', storage_mb: '' } as Record<keyof PlanLimits, string>,
  features: { gold_ticker: true, auto_responder: true, woocommerce: false, api_access: false } as PlanFeatures,
};

const LIMIT_LABELS: Array<{ key: keyof PlanLimits; label: string }> = [
  { key: 'max_channels', label: 'سقف کانال‌ها' },
  { key: 'max_posts', label: 'سقف پست‌ها' },
  { key: 'max_bots', label: 'سقف ربات‌ها' },
  { key: 'max_schedules', label: 'سقف زمان‌بندی‌ها' },
  { key: 'ai_monthly', label: 'سهم ماهانه هوش مصنوعی' },
  { key: 'storage_mb', label: 'حجم ذخیره‌سازی (مگابایت)' },
];

const FEATURE_LABELS: Array<{ key: keyof PlanFeatures; label: string }> = [
  { key: 'gold_ticker', label: 'نرخ لحظه‌ای طلا و سکه' },
  { key: 'auto_responder', label: 'پاسخ‌گوی خودکار' },
  { key: 'woocommerce', label: 'اتصال ووکامرس' },
  { key: 'api_access', label: 'دسترسی API' },
];

function parseLatin(value: string): number {
  const n = Number(toLatinDigits(value).trim());
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

export default function AdminPlans() {
  const toast = useToast();

  const [plans, setPlans] = useState<AdminPlanDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlanDto | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminPlanDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ plans?: AdminPlanDto[] }>('/api/v1/admin/plans');
      setPlans(d.plans ?? []);
    } catch (err) {
      toast.error(errText(err, 'دریافت پلن‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (plan: AdminPlanDto) => {
    setEditing(plan);
    setForm({
      code: plan.code,
      nameFa: plan.nameFa,
      priceRial: String(plan.priceRial ?? ''),
      periodDays: String(plan.periodDays ?? ''),
      limits: {
        max_channels: String(plan.limitsJson?.max_channels ?? ''),
        max_posts: String(plan.limitsJson?.max_posts ?? ''),
        max_bots: String(plan.limitsJson?.max_bots ?? ''),
        max_schedules: String(plan.limitsJson?.max_schedules ?? ''),
        ai_monthly: String(plan.limitsJson?.ai_monthly ?? ''),
        storage_mb: String(plan.limitsJson?.storage_mb ?? ''),
      },
      features: {
        gold_ticker: plan.featuresJson?.gold_ticker === true,
        auto_responder: plan.featuresJson?.auto_responder === true,
        woocommerce: plan.featuresJson?.woocommerce === true,
        api_access: plan.featuresJson?.api_access === true,
      },
    });
    setModalOpen(true);
  };

  const submitPlan = async () => {
    const price = parseLatin(form.priceRial);
    const period = parseLatin(form.periodDays);
    if (!editing && !form.code.trim()) {
      toast.error('کد پلن را وارد کنید.');
      return;
    }
    if (form.nameFa.trim().length < 2) {
      toast.error('نام فارسی پلن را وارد کنید.');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      toast.error('قیمت پلن را به ریال و به‌صورت عدد وارد کنید.');
      return;
    }
    if (Number.isNaN(period) || period < 1) {
      toast.error('دورهٔ پلن را به روز و حداقل ۱ روز وارد کنید.');
      return;
    }
    const limits = {} as PlanLimits;
    for (const { key } of LIMIT_LABELS) {
      const n = parseLatin(form.limits[key] || '0');
      if (Number.isNaN(n) || n < 0) {
        toast.error(`مقدار «${LIMIT_LABELS.find((l) => l.key === key)?.label}» باید عددی نامنفی باشد.`);
        return;
      }
      limits[key] = n;
    }

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/v1/admin/plans/${editing.id}`, {
          nameFa: form.nameFa.trim(),
          priceRial: price,
          periodDays: period,
          isActive: editing.isActive !== false,
          limitsJson: limits,
          featuresJson: form.features,
        });
        toast.success('پلن به‌روزرسانی شد.');
      } else {
        await api.post('/api/v1/admin/plans', {
          code: form.code.trim(),
          nameFa: form.nameFa.trim(),
          priceRial: price,
          periodDays: period,
          limitsJson: limits,
          featuresJson: form.features,
        });
        toast.success('پلن جدید ایجاد شد.');
      }
      setModalOpen(false);
      await loadPlans();
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ پلن ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: AdminPlanDto) => {
    setToggleBusyId(plan.id);
    try {
      await api.put(`/api/v1/admin/plans/${plan.id}`, { isActive: plan.isActive === false });
      toast.success(plan.isActive === false ? 'پلن فعال شد.' : 'پلن غیرفعال شد.');
      await loadPlans();
    } catch (err) {
      toast.error(errText(err, 'تغییر وضعیت پلن ناموفق بود.'));
    } finally {
      setToggleBusyId(null);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.del(`/api/v1/admin/plans/${deleteTarget.id}`);
      toast.success('پلن حذف شد.');
      setDeleteTarget(null);
      await loadPlans();
    } catch (err) {
      // e.g. plan in use → server Persian message is surfaced
      toast.error(errText(err, 'حذف پلن ناموفق بود.'));
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head adm-page-head--row">
        <div>
          <h2>اشتراک‌ها (پلن‌ها)</h2>
          <p>تعریف و ویرایش پلن‌های اشتراک سامانه</p>
        </div>
        <Button onClick={openCreate}>+ افزودن پلن</Button>
      </div>

      <Card>
        {loading ? (
          <PageLoading />
        ) : plans.length === 0 ? (
          <EmptyState
            icon="💎"
            title="هنوز پلنی تعریف نشده"
            description="با دکمهٔ «افزودن پلن» اولین پلن اشتراک را بسازید."
            action={<Button variant="soft" onClick={openCreate}>افزودن پلن</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table adm-table--cards">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نام</th>
                  <th>قیمت</th>
                  <th>دوره</th>
                  <th>وضعیت</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td data-label="کد" dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12.5 }}>{p.code}</td>
                    <td data-label="نام" style={{ fontWeight: 600 }}>{p.nameFa}</td>
                    <td data-label="قیمت" style={{ fontWeight: 700 }}>{faMoney(p.priceRial)}</td>
                    <td data-label="دوره">{faDigits(p.periodDays)} روز</td>
                    <td data-label="وضعیت">
                      {p.isActive === false ? <Badge tone="muted">غیرفعال</Badge> : <Badge tone="success">فعال</Badge>}
                    </td>
                    <td>
                      <div className="adm-table-actions">
                        <Button size="sm" variant="soft" onClick={() => openEdit(p)}>ویرایش</Button>
                        <Button size="sm" variant="ghost" loading={toggleBusyId === p.id} onClick={() => void toggleActive(p)}>
                          {p.isActive === false ? 'فعال‌سازی' : 'غیرفعال‌سازی'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)}>حذف</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `ویرایش پلن «${editing.nameFa}»` : 'افزودن پلن جدید'}
        large
      >
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {!editing && (
            <Field label="کد پلن" required hint="مثلاً pro — پس از ثبت قابل تغییر نیست.">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="pro" />
            </Field>
          )}
          {editing && (
            <Field label="کد پلن">
              <Input dir="ltr" style={{ textAlign: 'left' }} value={editing.code} disabled />
            </Field>
          )}
          <Field label="نام فارسی" required>
            <Input value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} placeholder="مثلاً اشتراک حرفه‌ای" />
          </Field>
          <Field label="قیمت (ریال)" required hint={Number.isFinite(parseLatin(form.priceRial)) ? `نمایش به کاربر: ${faMoney(parseLatin(form.priceRial) || 0)}` : 'مبلغ به ریال ذخیره می‌شود.'}>
            <Input dir="ltr" style={{ textAlign: 'left' }} inputMode="numeric" value={form.priceRial} onChange={(e) => setForm({ ...form, priceRial: e.target.value })} placeholder="مثلاً 4900000" />
          </Field>
          <Field label="دوره (روز)" required>
            <Input dir="ltr" style={{ textAlign: 'left' }} inputMode="numeric" value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: e.target.value })} placeholder="مثلاً 30" />
          </Field>
        </div>

        <div className="adm-subhead">محدودیت‌های پلن</div>
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {LIMIT_LABELS.map(({ key, label }) => (
            <Field key={key} label={label}>
              <Input
                dir="ltr"
                style={{ textAlign: 'left' }}
                inputMode="numeric"
                value={form.limits[key]}
                onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: e.target.value } })}
                placeholder="0"
              />
            </Field>
          ))}
        </div>

        <div className="adm-subhead">امکانات پلن</div>
        <div className="adm-checks">
          {FEATURE_LABELS.map(({ key, label }) => (
            <label key={key} className="adm-check">
              <input
                type="checkbox"
                checked={form.features[key]}
                onChange={(e) => setForm({ ...form, features: { ...form.features, [key]: e.target.checked } })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button onClick={() => void submitPlan()} loading={saving}>{editing ? 'ذخیرهٔ تغییرات' : 'ایجاد پلن'}</Button>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void submitDelete()}
        title="حذف پلن"
        message={`پلن «${deleteTarget?.nameFa ?? ''}» حذف می‌شود. اگر کاربران فعال روی این پلن باشند، حذف انجام نمی‌شود. ادامه می‌دهید؟`}
        danger
        busy={deleteBusy}
      />
    </>
  );
}
