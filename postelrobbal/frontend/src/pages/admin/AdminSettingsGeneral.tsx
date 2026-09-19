import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading, Textarea } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { boolField, errText, strField, Toggle } from './shared';

/* ------------------------------------------------------------------ */
/* تنظیمات عمومی — dedicated form page (Task 17-b). Site identity,     */
/* support contacts, terms note and the maintenance-mode switch.       */
/* GET/PUT /admin/settings/general → full snapshot in / full patch out. */
/* ------------------------------------------------------------------ */

interface GeneralSettings {
  siteNameFa: string;
  siteTaglineFa: string;
  supportEmail: string;
  supportPhone: string;
  termsNoteFa: string;
  maintenanceEnabled: boolean;
  maintenanceMessageFa: string;
}

export default function AdminSettingsGeneral() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const [siteNameFa, setSiteNameFa] = useState('');
  const [siteTaglineFa, setSiteTaglineFa] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [termsNoteFa, setTermsNoteFa] = useState('');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessageFa, setMaintenanceMessageFa] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/general');
        if (!alive) return;
        setSiteNameFa(strField(d.siteNameFa));
        setSiteTaglineFa(strField(d.siteTaglineFa));
        setSupportEmail(strField(d.supportEmail));
        setSupportPhone(strField(d.supportPhone));
        setTermsNoteFa(strField(d.termsNoteFa));
        setMaintenanceEnabled(boolField(d.maintenanceEnabled));
        setMaintenanceMessageFa(strField(d.maintenanceMessageFa));
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات عمومی ناموفق بود.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!siteNameFa.trim()) {
      toast.error('نام سایت را وارد کنید.');
      return;
    }
    if (supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail.trim())) {
      toast.error('ایمیل پشتیبانی معتبر نیست.');
      return;
    }
    setSaving(true);
    try {
      const payload: GeneralSettings = {
        siteNameFa: siteNameFa.trim(),
        siteTaglineFa: siteTaglineFa.trim(),
        supportEmail: supportEmail.trim(),
        supportPhone: supportPhone.trim(),
        termsNoteFa: termsNoteFa.trim(),
        maintenanceEnabled,
        maintenanceMessageFa: maintenanceMessageFa.trim(),
      };
      await api.put('/api/v1/admin/settings/general', payload);
      toast.success('تنظیمات عمومی ذخیره شد.');
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات عمومی ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>تنظیمات عمومی</h2>
        <p>نام و شعار سایت، راه‌های ارتباطی، یادداشت قوانین و حالت تعمیر و نگهداری</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات عمومی با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <div className="adm-card-head"><strong>شناسهٔ سایت</strong></div>
        <div className="adm-form-grid">
          <Field label="نام سایت" required hint="در سربرگ پنل، ایمیل‌ها و صفحات عمومی نمایش داده می‌شود.">
            <Input value={siteNameFa} onChange={(e) => setSiteNameFa(e.target.value)} placeholder="مثلاً پُست‌یار" />
          </Field>
          <Field label="شعار سایت">
            <Input value={siteTaglineFa} onChange={(e) => setSiteTaglineFa(e.target.value)} placeholder="مثلاً انتشار هوشمند در پیام‌رسان‌ها" />
          </Field>
        </div>
        <div className="adm-form-grid">
          <Field label="ایمیل پشتیبانی">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@postyar.ir" />
          </Field>
          <Field label="تلفن پشتیبانی">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="021-00000000" />
          </Field>
        </div>
        <Field label="یادداشت قوانین" hint="متن کوتاهی که در فرم ثبت‌نام و صفحات عمومی همراه لینک قوانین نمایش داده می‌شود.">
          <Textarea rows={3} value={termsNoteFa} onChange={(e) => setTermsNoteFa(e.target.value)} placeholder="یادداشت دلخواه دربارهٔ قوانین و مقررات…" />
        </Field>
      </Card>

      <Card>
        <div className="adm-card-head"><strong>حالت تعمیر و نگهداری</strong></div>
        <div className="adm-inline-row">
          <div>
            <div className="adm-inline-row__title">حالت تعمیر و نگهداری</div>
            <div className="adm-inline-row__desc">
              در صورت فعال بودن، کاربران عادی به‌جای سامانه پیام حالت تعمیر را می‌بینند؛ مدیران همچنان دسترسی دارند.
            </div>
          </div>
          <Toggle checked={maintenanceEnabled} onChange={setMaintenanceEnabled} label="حالت تعمیر و نگهداری" />
        </div>
        {maintenanceEnabled && (
          <Field label="پیام حالت تعمیر" hint="این پیام به کاربران در زمان تعمیر نمایش داده می‌شود.">
            <Textarea
              rows={3}
              value={maintenanceMessageFa}
              onChange={(e) => setMaintenanceMessageFa(e.target.value)}
              placeholder="مثلاً: سامانه موقتاً در دست تعمیر است؛ به‌زودی بازمی‌گردیم."
            />
          </Field>
        )}
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییرات پس از ذخیره برای همهٔ کاربران اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
