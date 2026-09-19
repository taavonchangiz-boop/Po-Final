import { useState } from 'react';
import { faDigits, faMoney } from '../lib/format';
import type { PlanDto } from '../lib/api';

const FEATURES = [
  { icon: '📻', title: 'مدیریت کانال‌ها', text: 'همهٔ کانال‌های تلگرام، بله و روبیکا در یک پنل؛ اتصال، تأیید و مدیریت بدون جابه‌جایی.' },
  { icon: '✉️', title: 'انتشار هم‌زمان', text: 'یک پست بنویسید و هم‌زمان در همهٔ کانال‌های انتخابی‌تان منتشر کنید.' },
  { icon: '⏰', title: 'زمان‌بندی خودکار', text: 'پست‌ها را با تقویم شمسی زمان‌بندی کنید؛ پُستیار سر موعد دقیق منتشر می‌کند.' },
  { icon: '🤖', title: 'ربات‌ساز بدون کدنویسی', text: 'ربات بسازید، دستور و پاسخ تعریف کنید و گردش‌کارهای خودکار طراحی کنید.' },
  { icon: '🧠', title: 'هوش مصنوعی', text: 'کپشن‌های حرفه‌ای بنویسید و پاسخگوی هوشمند به مشتریان داشته باشید.' },
  { icon: '📊', title: 'تحلیل آمار کامل', text: 'آمار کلیک، بازخورد و عملکرد هر پست و هر کانال را دقیق ببینید.' },
];

const PLATFORM_CARDS = [
  { name: 'تلگرام', desc: 'پرمخاطب‌ترین پیام‌رسان برای کانال‌های محتوایی و فروشگاهی؛ پشتیبانی کامل از دکمه‌های شیشه‌ای و رسانه.', color: '#229ED9', icon: '✈️' },
  { name: 'بله', desc: 'پیام‌رسان بانکی و امن؛ انتشار خودکار محتوا و ربات‌های پاسخگو با پُستیار.', color: '#25D366', icon: '💠' },
  { name: 'روبیکا', desc: 'پیام‌رسان پرکاربرد ایرانی؛ مدیریت کانال و انتشار محتوا به‌صورت درجه یک در پُستیار.', color: '#E91E63', icon: '🔴' },
];

const STEPS = [
  { n: '۱', title: 'ثبت‌نام کنید', text: 'در کمتر از یک دقیقه حساب رایگان بسازید.' },
  { n: '۲', title: 'کانال‌ها را وصل کنید', text: 'ربات پُستیار را ادمین کانال‌های شما کنید؛ تلگرام، بله و روبیکا.' },
  { n: '۳', title: 'بسازید و منتشر کنید', text: 'پست بنویسید، مقصدها را انتخاب کنید و الان یا زمان‌بندی‌شده منتشر کنید.' },
];

const FAQ = [
  { q: 'آیا برای ساخت ربات باید برنامه‌نویسی بلد باشم؟', a: 'خیر. پُستیار همهٔ کارها را بدون حتی یک خط کد انجام می‌دهد؛ ربات را با توکن رسمی پیام‌رسان وصل می‌کنید و همه‌چیز از پنل مدیریت می‌شود.' },
  { q: 'پست‌های زمان‌بندی‌شده چطور ارسال می‌شوند؟', a: 'پُستیار از موتور زمان‌بندی اختصاصی با صف ارسال، تلاش مجدد خودکار و گزارش دقیق وضعیت هر ارسال استفاده می‌کند تا هیچ پستی از دست نرود.' },
  { q: 'روبیکا واقعاً پشتیبانی می‌شود؟', a: 'بله؛ روبیکا مانند تلگرام و بله یک پلتفرم درجه اول در پُستیار است و آداپتور اختصاصی خودش را دارد.' },
  { q: 'اگر ارسال پیامی شکست بخورد چه می‌شود؟', a: 'وضعیت دقیق هر ارسال (موفق، در حال تلاش مجدد، ناموفق) را با دلیل آن می‌بینید و می‌توانید ارسال ناموفق را دوباره اجرا کنید.' },
];

export default function Landing() {
  return (
    <div>
      {/* Hero */}
      <section style={{ background: 'var(--brand-grad)', color: '#fff', padding: '72px 20px 88px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <img src="./images/logo-full.webp" alt="پُستیار" width={190} height={104} style={{ objectFit: 'contain', marginBottom: 20, borderRadius: 16, background: '#fff', padding: 10 }} />
          <h1 style={{ fontSize: 'clamp(26px, 5vw, 44px)', fontWeight: 900, lineHeight: 1.5, marginBottom: 16 }}>
            مدیریت هوشمند و انتشار خودکار<br />در تلگرام، بله و روبیکا
          </h1>
          <p style={{ fontSize: 'clamp(15px, 2.2vw, 18px)', opacity: 0.94, maxWidth: 640, margin: '0 auto 30px', lineHeight: 2 }}>
            یک‌بار بساز، همه‌جا منتشر کن. کانال‌ها، ربات‌ها، اتوماسیون، هوش مصنوعی و تحلیل آمار — همه در یک پنل فارسی.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#pricing" className="btn btn-lg" style={{ background: '#fff', color: 'var(--brand-strong)' }}>شروع رایگان</a>
            <a href="#features" className="btn btn-lg btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}>مشاهده امکانات</a>
          </div>
        </div>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.14), transparent 40%), radial-gradient(circle at 15% 85%, rgba(255,255,255,0.1), transparent 40%)' }} />
      </section>

      {/* Pain points */}
      <section style={{ maxWidth: 1100, margin: '-40px auto 0', padding: '0 20px', position: 'relative', zIndex: 2 }}>
        <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18, padding: 26 }}>
          {[
            ['😵‍💫', 'جابه‌جایی بین چند اپ؟', 'محتوا را یک‌بار در پُستیار آماده کنید و همه‌جا هم‌زمان بفرستید.'],
            ['⌛', 'زمان‌بندی دستی؟', 'تقویم شمسی پُستیار سر موعد، خودش منتشر می‌کند.'],
            ['🙈', 'بی‌خبر از نتیجه؟', 'وضعیت تک‌تک ارسال‌ها و کلیک‌ها را شفاف ببینید.'],
          ].map(([icon, title, text]) => (
            <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 26 }} aria-hidden="true">{icon}</span>
              <div>
                <strong style={{ display: 'block', fontSize: 14.5 }}>{title}</strong>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{text}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core features */}
      <section id="features" style={{ maxWidth: 1100, margin: '64px auto 0', padding: '0 20px' }}>
        <SectionTitle title="هر آنچه برای انتشار حرفه‌ای نیاز دارید" subtitle="از اتصال کانال تا تحلیل آمار؛ همه‌چیز یکجا" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card" style={{ transition: 'transform .18s' }}>
              <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden="true">{f.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{f.title}</h3>
              <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 2 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ maxWidth: 1000, margin: '64px auto 0', padding: '0 20px' }}>
        <SectionTitle title="در ۳ مرحلهٔ ساده شروع کنید" subtitle="بدون دانش فنی، بدون پیچیدگی" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
          {STEPS.map((s) => (
            <div key={s.n} className="card" style={{ textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--brand-grad)', color: '#fff', fontSize: 22, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }} aria-hidden="true">
                {s.n}
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6 }}>{s.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platforms */}
      <section style={{ maxWidth: 1100, margin: '64px auto 0', padding: '0 20px' }}>
        <SectionTitle title="پلتفرم‌های درجه اول" subtitle="تلگرام، بله و روبیکا؛ هرکدام با آداپتور اختصاصی و بدون محدودیت" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
          {PLATFORM_CARDS.map((p) => (
            <div key={p.name} className="card" style={{ borderTop: `4px solid ${p.color}` }}>
              <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden="true">{p.icon}</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>{p.name}</h3>
              <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 2 }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Advanced features strip */}
      <section style={{ maxWidth: 1100, margin: '64px auto 0', padding: '0 20px', display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <FeatureRow icon="🛍️" title="یکپارچگی با ووکامرس" text="محصولات فروشگاه ووکامرسی شما به‌صورت خودکار به کانال‌ها منتشر می‌شود؛ همگام‌سازی قیمت و موجودی." />
        <FeatureRow icon="🪙" title="ربات نرخ لحظه‌ای طلا و سکه" text="نرخ طلا، سکه و ارز را به‌صورت خودکار و زمان‌بندی‌شده در کانال شما منتشر کنید." />
        <FeatureRow icon="🔀" title="اتوماسیون و گردش‌کار" text="پاسخ‌های خودکار، دستورهای ربات و گردش‌کارهای چندمرحله‌ای بدون کدنویسی." />
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ maxWidth: 1200, margin: '64px auto 0', padding: '0 20px' }}>
        <SectionTitle title="تعرفه‌های پُستیار" subtitle="با پلن رایگان شروع کنید؛ هر وقت خواستید ارتقا دهید" />
        <PricingGrid />
      </section>

      {/* FAQ */}
      <section id="faq" style={{ maxWidth: 820, margin: '64px auto 0', padding: '0 20px' }}>
        <SectionTitle title="سؤالات متداول" subtitle="پاسخ پرتکرارترین پرسش‌ها" />
        <div style={{ display: 'grid', gap: 12 }}>
          {FAQ.map((f) => (
            <details key={f.q} className="card" style={{ padding: 0 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14.5, padding: '16px 20px', listStyle: 'none' }}>
                {f.q}
              </summary>
              <p style={{ padding: '0 20px 18px', color: 'var(--text-2)', fontSize: 13.5, lineHeight: 2 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ maxWidth: 1000, margin: '64px auto', padding: '0 20px' }}>
        <div className="card" style={{ background: 'var(--brand-grad)', border: 'none', color: '#fff', textAlign: 'center', padding: '48px 28px' }}>
          <h2 style={{ fontSize: 'clamp(20px, 3.4vw, 28px)', fontWeight: 900, marginBottom: 10 }}>همین امروز انتشار حرفه‌ای را شروع کنید</h2>
          <p style={{ opacity: 0.92, marginBottom: 24, fontSize: 15 }}>حساب رایگان بسازید؛ بدون نیاز به کارت بانکی.</p>
          <a href="/?auth=register" className="btn btn-lg" style={{ background: '#fff', color: 'var(--brand-strong)' }}>ساخت حساب رایگان</a>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 30 }}>
      <h2 style={{ fontSize: 'clamp(20px, 3.2vw, 27px)', fontWeight: 900, marginBottom: 6 }}>{title}</h2>
      <p style={{ color: 'var(--text-2)', fontSize: 14.5 }}>{subtitle}</p>
    </div>
  );
}

function FeatureRow({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 28 }} aria-hidden="true">{icon}</span>
      <div>
        <h3 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>{title}</h3>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 2 }}>{text}</p>
      </div>
    </div>
  );
}

function PricingGrid() {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [error, setError] = useState(false);

  if (plans === null && !error) {
    void fetch('/api/v1/subscriptions/plans', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setPlans(j.data?.plans ?? []))
      .catch(() => setError(true));
  }

  if (error) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-2)' }}>
        برای مشاهدهٔ تعرفه‌ها و ثبت‌نام، وارد پنل کاربری شوید.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 16 }}>
      {(plans ?? []).map((p) => (
        <div key={p.id} className="card" style={{ textAlign: 'center', position: 'relative', borderColor: p.code === 'professional' ? 'var(--brand)' : undefined, borderWidth: p.code === 'professional' ? 2 : 1 }}>
          {p.code === 'professional' && (
            <span style={{ position: 'absolute', top: -12, right: '50%', transform: 'translateX(50%)', background: 'var(--brand)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 12px' }}>
              پیشنهاد ما
            </span>
          )}
          <h3 style={{ fontSize: 17, fontWeight: 800, margin: '8px 0 4px' }}>{p.nameFa}</h3>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--brand-strong)' }}>
            {p.priceRial === 0 ? 'رایگان' : faMoney(p.priceRial)}
            {p.priceRial > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }} aria-hidden="true"> / ماهانه</span>}
          </div>
          <ul style={{ listStyle: 'none', margin: '16px 0', display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-2)', textAlign: 'right' }}>
            <li>✔ تا {p.limitsJson.max_channels === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_channels)} کانال`}</li>
            <li>✔ {p.limitsJson.max_posts === 0 ? 'پست نامحدود' : `${faDigits(p.limitsJson.max_posts)} پست در دوره`}</li>
            <li>✔ تا {p.limitsJson.max_bots === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_bots)}`} ربات</li>
            <li>✔ {p.featuresJson.gold_ticker ? 'ربات نرخ لحظه‌ای طلا و سکه' : '—'}</li>
            <li>✔ {p.featuresJson.woocommerce ? 'اتصال ووکامرس' : '—'}</li>
          </ul>
          <a href="/?auth=register" className={`btn ${p.code === 'professional' ? 'btn-primary' : 'btn-ghost'} btn-block`}>
            {p.priceRial === 0 ? 'شروع رایگان' : 'خرید اشتراک'}
          </a>
        </div>
      ))}
    </div>
  );
}
