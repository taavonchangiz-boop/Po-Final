import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { faNumber, toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { errText } from './shared';

/* ------------------------------------------------------------------ */
/* زیرمجموعه‌گیری — referral reward points (Task 17-b).                */
/* GET/PUT /admin/settings/referral → { registerRewardPoints }.        */
/* ------------------------------------------------------------------ */

export default function AdminSettingsReferral() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [pointsInput, setPointsInput] = useState('');
  const [savedPoints, setSavedPoints] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<{ registerRewardPoints?: number }>('/api/v1/admin/settings/referral');
        if (!alive) return;
        const n = Number(d.registerRewardPoints ?? 0);
        setSavedPoints(Number.isFinite(n) ? n : 0);
        setPointsInput(String(Number.isFinite(n) ? n : 0));
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات زیرمجموعه‌گیری ناموفق بود.'));
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
    const n = Number(toLatinDigits(pointsInput).trim());
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error('امتیاز پاداش را به‌صورت عدد صحیح نامنفی وارد کنید.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/referral', { registerRewardPoints: n });
      toast.success('امتیاز پاداش معرفی ذخیره شد.');
      setSavedPoints(n);
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات زیرمجموعه‌گیری ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>زیرمجموعه‌گیری</h2>
        <p>امتیاز پاداشی که به معرِّف کاربر جدید تعلق می‌گیرد</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>امتیاز پاداش معرفی با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <div className="adm-card-head"><strong>پاداش معرفی کاربر جدید</strong></div>
        <Field
          label="امتیاز پاداش معرفی کاربر جدید"
          hint={`امتیاز کنونی: ${faNumber(savedPoints)}`}
        >
          <Input
            dir="ltr"
            style={{ textAlign: 'left' }}
            inputMode="numeric"
            value={pointsInput}
            onChange={(e) => setPointsInput(e.target.value)}
            placeholder="100"
          />
        </Field>
        <div className="adm-note adm-note--info">
          <span aria-hidden="true">ℹ️</span>
          <span>این امتیاز بلافاصله برای معرفی‌های جدید اعمال می‌شود.</span>
        </div>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییرات پس از ذخیره برای ثبت‌نام‌های جدید اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
