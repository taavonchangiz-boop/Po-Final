import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { errText, strField } from './shared';

/* ------------------------------------------------------------------ */
/* هوش مصنوعی — default provider picker (Task 17-b).                   */
/* GET/PUT /admin/settings/ai → { default_provider }.                  */
/* ------------------------------------------------------------------ */

type AiProvider = 'openai' | 'deepseek' | 'mistral' | 'openrouter' | 'gemini' | 'anthropic';

const PROVIDERS: Array<{ key: AiProvider; title: string; desc: string }> = [
  { key: 'openai', title: 'OpenAI', desc: 'پیشرو در مدل‌های زبانی عمومی؛ مناسب تولید محتوا و پاسخ‌گویی' },
  { key: 'deepseek', title: 'DeepSeek', desc: 'کیفیت بالا با هزینهٔ تمام‌شدهٔ پایین‌تر' },
  { key: 'mistral', title: 'Mistral', desc: 'سریع و سبک؛ گزینهٔ اقتصادی برای کارهای روزمره' },
  { key: 'openrouter', title: 'OpenRouter', desc: 'دسترسی به ده‌ها مدل مختلف از طریق یک کلید واحد' },
  { key: 'gemini', title: 'Google Gemini', desc: 'مدل چندوجهی گوگل با پشتیبانی خوب از زبان فارسی' },
  { key: 'anthropic', title: 'Anthropic Claude', desc: 'کیفیت نوشتار بالا و پیروی دقیق از دستورها' },
];

export default function AdminSettingsAi() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [savedProvider, setSavedProvider] = useState<AiProvider>('openai');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/ai');
        if (!alive) return;
        const p = strField(d.default_provider) as AiProvider;
        const valid = PROVIDERS.some((x) => x.key === p) ? p : 'openai';
        setProvider(valid);
        setSavedProvider(valid);
      } catch (err) {
        if (alive) toast.error(errText(err, 'دریافت تنظیمات هوش مصنوعی ناموفق بود.'));
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
    setSaving(true);
    try {
      await api.put('/api/v1/admin/settings/ai', { default_provider: provider });
      toast.success('سرویس‌دهندهٔ پیش‌فرض هوش مصنوعی ذخیره شد.');
      setSavedProvider(provider);
      setSavedNote(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات هوش مصنوعی ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>هوش مصنوعی</h2>
        <p>سرویس‌دهندهٔ پیش‌فرض فعلی: {PROVIDERS.find((x) => x.key === savedProvider)?.title ?? '—'}</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>سرویس‌دهندهٔ پیش‌فرض با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <div className="adm-card-head"><strong>سرویس‌دهندهٔ پیش‌فرض هوش مصنوعی</strong></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px' }}>
          این سرویس‌دهنده برای کاربرانی استفاده می‌شود که سرویس اختصاصی خودشان را تنظیم نکرده‌اند.
        </p>
        <div className="adm-picker" role="radiogroup" aria-label="انتخاب سرویس‌دهندهٔ پیش‌فرض هوش مصنوعی">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={provider === p.key}
              className={`adm-picker__tile${provider === p.key ? ' is-active' : ''}`}
              onClick={() => setProvider(p.key)}
            >
              <span className="adm-picker__title">
                {p.title}
                {provider === p.key && <Badge tone="brand">فعال</Badge>}
              </span>
              <span className="adm-picker__desc">{p.desc}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">تغییر پس از ذخیره برای درخواست‌های جدید اعمال می‌شود.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
