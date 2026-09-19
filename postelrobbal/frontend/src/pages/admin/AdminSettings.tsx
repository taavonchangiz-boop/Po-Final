import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Textarea } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { errText } from './shared';

/* ------------------------------------------------------------------ */
/* تنظیمات عمومی — generic JSON key/value editor. Payment, SMS and     */
/* email keys are excluded client-side: they now live in their own     */
/* dedicated admin sections (Task 16-b).                               */
/* ------------------------------------------------------------------ */

interface SettingRow {
  key: string;
  text: string;
}

/** Payment/SMS/Email settings moved to dedicated sections. */
const MANAGED_EXACT = new Set([
  'paymentOnlineEnabled',
  'paymentCardToCardEnabled',
  'paymentProvider',
  'paymentGateways',
  'cardToCardCards',
]);

const MANAGED_PREFIXES = ['sms', 'email', 'smtp'];

function isManagedKey(key: string): boolean {
  if (MANAGED_EXACT.has(key)) return true;
  return MANAGED_PREFIXES.some((p) => key.startsWith(p));
}

const SETTINGS_KEY_FA: Record<string, string> = {
  referral: 'تنظیمات زیرمجموعه‌گیری',
  gold: 'تنظیمات ربات نرخ طلا',
  ai: 'تنظیمات هوش مصنوعی',
  security: 'تنظیمات امنیتی',
  plan: 'تنظیمات پلن‌ها',
};

export default function AdminSettings() {
  const toast = useToast();

  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings');
      setRows(
        Object.entries(d)
          .filter(([k]) => !isManagedKey(k))
          .map(([k, v]) => ({ key: k, text: JSON.stringify(v ?? null, null, 2) }))
      );
    } catch (err) {
      toast.error(errText(err, 'دریافت تنظیمات ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addKey = () => {
    const key = newKey.trim();
    if (!key) {
      toast.error('نام کلید را وارد کنید.');
      return;
    }
    if (isManagedKey(key)) {
      toast.error('این کلید در بخش اختصاصی خودش (پرداخت/پیامک/ایمیل) مدیریت می‌شود.');
      return;
    }
    if (rows.some((r) => r.key === key)) {
      toast.error('این کلید از قبل وجود دارد.');
      return;
    }
    setRows((prev) => [...prev, { key, text: '{}' }]);
    setNewKey('');
  };

  const saveAll = async () => {
    const payload: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        payload[row.key] = JSON.parse(row.text) as unknown;
      } catch {
        setErrorKey(row.key);
        toast.error(`متن JSON کلید «${row.key}» معتبر نیست.`);
        return;
      }
    }
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings', payload);
      toast.success('تنظیمات عمومی ذخیره شد.');
      setErrorKey(null);
      await loadSettings();
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>تنظیمات عمومی</h2>
        <p>کلیدهای JSON سامانه — تنظیمات پرداخت، پیامک و ایمیل در بخش‌های اختصاصی خودشان است</p>
      </div>

      <div className="adm-note adm-note--danger" role="alert">
        <span aria-hidden="true">⚠️</span>
        <span>
          هشدار: کلیدهای ناشناخته ممکن است رفتار امکانات سامانه را تغییر دهند. فقط مقدار کلیدی را ویرایش کنید که ساختارش را می‌دانید؛ پس از ذخیره، تغییرات برای همهٔ کاربران اعمال می‌شود.
        </span>
      </div>

      <Card className="adm-savebar">
        <div style={{ flex: 1, minWidth: 220 }}>
          <Field label="کلید جدید" hint="مثلاً referral یا security">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="مثلاً referral" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={addKey}>افزودن کلید</Button>
          <Button onClick={() => void saveAll()} loading={saving}>ذخیرهٔ همهٔ تغییرات</Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="🧩"
            title="کلید تنظیماتی برای نمایش نیست"
            description="با «افزودن کلید» یک کلید جدید بسازید یا مقدار پیش‌فرض پس از اولین استفاده سامانه اینجا ظاهر می‌شود."
          />
        </Card>
      ) : (
        rows.map((row) => (
          <Card key={row.key} className={`adm-keyrow${errorKey === row.key ? ' is-error' : ''}`}>
            <div className="adm-card-head">
              <strong>{SETTINGS_KEY_FA[row.key] ?? `تنظیمات (${row.key})`}</strong>
              <code dir="ltr" className="adm-keycode">{row.key}</code>
            </div>
            <Textarea
              dir="ltr"
              rows={6}
              style={{ fontFamily: 'monospace', fontSize: 12.5, textAlign: 'left' }}
              value={row.text}
              onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)))}
              aria-label={`مقدار JSON کلید ${row.key}`}
            />
          </Card>
        ))
      )}
    </>
  );
}
