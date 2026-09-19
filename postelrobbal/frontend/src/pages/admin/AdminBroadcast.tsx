import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, ConfirmDialog, Field, Input, Textarea } from '../../components/ui';
import { faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { errText } from './shared';

/* ------------------------------------------------------------------ */
/* اطلاع‌رسانی — broadcast a message to every user (Task 16-b).        */
/* ------------------------------------------------------------------ */

export default function AdminBroadcast() {
  const toast = useToast();

  const [titleFa, setTitleFa] = useState('');
  const [bodyFa, setBodyFa] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const ready = titleFa.trim().length >= 3 && bodyFa.trim().length >= 3;

  const send = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ recipients?: number }>('/api/v1/admin/broadcast', { titleFa: titleFa.trim(), bodyFa: bodyFa.trim() });
      const count = typeof d?.recipients === 'number' ? d.recipients : null;
      const msg = count === null
        ? 'اطلاع‌رسانی همگانی با موفقیت برای همهٔ کاربران ارسال شد.'
        : `پیام با موفقیت برای ${faNumber(count)} کاربر ارسال شد.`;
      toast.success(msg);
      setResult(msg);
      setTitleFa('');
      setBodyFa('');
      setConfirmOpen(false);
    } catch (err) {
      toast.error(errText(err, 'ارسال همگانی ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head">
        <h2>اطلاع‌رسانی همگانی</h2>
        <p>ارسال اعلان برای همهٔ کاربران سامانه — داخل پیشخوان و اپلیکیشن نمایش داده می‌شود</p>
      </div>

      {result && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>{result}</span>
        </div>
      )}

      <Card>
        <Field label="عنوان پیام" required hint="حداقل ۳ نویسه">
          <Input value={titleFa} onChange={(e) => setTitleFa(e.target.value)} placeholder="مثلاً به‌روزرسانی مهم سامانه" />
        </Field>
        <Field label="متن پیام" required hint="این متن برای همهٔ کاربران به‌عنوان اعلان ارسال می‌شود.">
          <Textarea rows={6} value={bodyFa} onChange={(e) => setBodyFa(e.target.value)} placeholder="متن پیام همگانی…" />
        </Field>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!ready}
          title={ready ? undefined : 'عنوان و متن پیام را کامل کنید.'}
        >
          ارسال همگانی
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => void send()}
        title="اطلاع‌رسانی همگانی"
        message="این پیام برای همهٔ کاربران سامانه ارسال می‌شود و امکان لغو آن وجود ندارد. برای همهٔ کاربران ارسال شود؟"
        danger
        busy={busy}
      />
    </>
  );
}
