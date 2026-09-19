import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { NavIcon, type NavIconName } from '../../components/icons';
import { faNumber } from '../../lib/format';
import { strField, boolField } from './shared';

/* ------------------------------------------------------------------ */
/* مرکز تنظیمات — hub (Task 17-b). A responsive card grid, one card    */
/* per settings area. The old generic JSON key/value editor is gone;   */
/* each area lives on its own dedicated form page.                     */
/* ------------------------------------------------------------------ */

interface SettingsCardDef {
  to: string;
  icon: NavIconName;
  title: string;
  desc: string;
  /** Key into the hints map for a cheap current-state line. */
  hintKey?: 'general' | 'ai' | 'referral' | 'security';
}

const CARDS: SettingsCardDef[] = [
  { to: '/dashboard/admin/settings/general', icon: 'home', title: 'عمومی', desc: 'نام و شعار سایت، ایمیل و تلفن پشتیبانی، قوانین و حالت تعمیر', hintKey: 'general' },
  { to: '/dashboard/admin/settings/ai', icon: 'ai', title: 'هوش مصنوعی', desc: 'انتخاب سرویس‌دهندهٔ پیش‌فرض مدل‌های زبانی', hintKey: 'ai' },
  { to: '/dashboard/admin/settings/referral', icon: 'referrals', title: 'زیرمجموعه‌گیری', desc: 'امتیاز پاداش معرفی کاربر جدید', hintKey: 'referral' },
  { to: '/dashboard/admin/settings/security', icon: 'admin', title: 'امنیت', desc: 'ثبت‌نام کاربران جدید و کپچای امنیتی ورود', hintKey: 'security' },
  { to: '/dashboard/admin/gateways', icon: 'woocommerce', title: 'درگاه پرداخت', desc: 'درگاه آنلاین، کارت به کارت و اعتبارنامهٔ هر درگاه' },
  { to: '/dashboard/admin/sms', icon: 'notifications', title: 'پیامک', desc: 'سرویس‌دهندهٔ پیامک و اعتبارنامهٔ ارسال' },
  { to: '/dashboard/admin/email', icon: 'posts', title: 'ایمیل', desc: 'سرور SMTP و ایمیل آزمایشی' },
];

export default function AdminSettings() {
  // Cheap current-state hints (best-effort; cards render regardless).
  const [hints, setHints] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      const results = await Promise.allSettled([
        api.get<Record<string, unknown>>('/api/v1/admin/settings/general'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/ai'),
        api.get<{ registerRewardPoints?: number }>('/api/v1/admin/settings/referral'),
        api.get<Record<string, unknown>>('/api/v1/admin/settings/security'),
      ]);
      if (!alive) return;
      const [general, ai, referral, security] = results;
      if (general.status === 'fulfilled') {
        const name = strField(general.value.siteNameFa).trim();
        const maint = boolField(general.value.maintenanceEnabled);
        if (maint) next.general = 'حالت تعمیر و نگهداری فعال است';
        else if (name) next.general = `نام سایت: ${name}`;
      }
      if (ai.status === 'fulfilled') {
        const p = strField(ai.value.default_provider);
        if (p) next.ai = `سرویس‌دهندهٔ فعلی: ${p}`;
      }
      if (referral.status === 'fulfilled' && Number.isFinite(Number(referral.value.registerRewardPoints))) {
        next.referral = `امتیاز معرفی: ${faNumber(Number(referral.value.registerRewardPoints))}`;
      }
      if (security.status === 'fulfilled') {
        const flags: string[] = [];
        if (security.value.registrationEnabled === false) flags.push('ثبت‌نام خاموش');
        if (security.value.captchaEnabled === false) flags.push('کپچا خاموش');
        if (flags.length) next.security = flags.join(' · ');
      }
      setHints(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="adm-page-head">
        <h2>مرکز تنظیمات</h2>
        <p>همهٔ تنظیمات سامانه به تفکیک بخش — هر بخش صفحهٔ اختصاصی خودش را دارد</p>
      </div>

      <div className="adm-settings-grid">
        {CARDS.map((c) => {
          const hint = c.hintKey ? hints[c.hintKey] : undefined;
          return (
            <Link key={c.to} to={c.to} className="adm-settings-card">
              <span className="adm-settings-card__icon" aria-hidden="true">
                <NavIcon name={c.icon} size={20} />
              </span>
              <strong>{c.title}</strong>
              <p>{c.desc}</p>
              {hint && <span className="adm-settings-card__hint">{hint}</span>}
              <span className="adm-settings-card__go">مشاهده و ویرایش ‹</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
