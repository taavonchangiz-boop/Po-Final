import { useEffect, useRef, useState, type ReactNode } from 'react';
import { faDigits, faMoney } from '../lib/format';
import type { PlanDto } from '../lib/api';
import { NavIcon, type NavIconName } from '../components/icons';
import { Logo } from '../components/Logo';
import { BaleIcon, RubikaIcon, TelegramIcon } from '../components/PlatformIcons';

/* ------------------------------------------------------------------ */
/* Landing 2026 — Task 14-a. Persian RTL, self-contained CSS/SVG art,  */
/* scroll-reveal via IntersectionObserver, counters, FAQ accordion.    */
/* Auth entry points stay deep-linked: /?auth=register & /?auth=login. */
/* ------------------------------------------------------------------ */

const FEATURES: Array<{ icon: NavIconName; title: string; text: string }> = [
  { icon: 'channels', title: 'مدیریت کانال‌ها', text: 'همهٔ کانال‌های تلگرام، بله و روبیکا در یک پنل؛ اتصال، تأیید و مدیریت بدون جابه‌جایی.' },
  { icon: 'posts', title: 'انتشار هم‌زمان', text: 'یک پست بنویسید و هم‌زمان در همهٔ کانال‌های انتخابی‌تان منتشر کنید.' },
  { icon: 'clock', title: 'زمان‌بندی خودکار', text: 'پست‌ها را با تقویم شمسی زمان‌بندی کنید؛ پُست‌یار سر موعد دقیق منتشر می‌کند.' },
  { icon: 'bots', title: 'ربات‌ساز بدون کدنویسی', text: 'ربات بسازید، دستور و پاسخ تعریف کنید و گردش‌کارهای خودکار طراحی کنید.' },
  { icon: 'ai', title: 'هوش مصنوعی', text: 'کپشن‌های حرفه‌ای بنویسید و پاسخگوی هوشمند به مشتریان داشته باشید.' },
  { icon: 'analytics', title: 'تحلیل آمار کامل', text: 'آمار کلیک، بازخورد و عملکرد هر پست و هر کانال را دقیق ببینید.' },
];

const PLATFORM_CARDS = [
  {
    name: 'تلگرام',
    desc: 'پرمخاطب‌ترین پیام‌رسان برای کانال‌های محتوایی و فروشگاهی؛ پشتیبانی کامل از دکمه‌های شیشه‌ای و رسانه.',
    Icon: TelegramIcon,
  },
  {
    name: 'بله',
    desc: 'پیام‌رسان بانکی و امن؛ انتشار خودکار محتوا و ربات‌های پاسخگو با پُست‌یار.',
    Icon: BaleIcon,
  },
  {
    name: 'روبیکا',
    desc: 'پیام‌رسان پرکاربرد ایرانی؛ مدیریت کانال و انتشار محتوا به‌صورت درجه یک در پُست‌یار.',
    Icon: RubikaIcon,
  },
];

const STEPS = [
  { n: '۱', title: 'ثبت‌نام کنید', text: 'در کمتر از یک دقیقه حساب رایگان بسازید.' },
  { n: '۲', title: 'کانال‌ها را وصل کنید', text: 'ربات پُست‌یار را ادمین کانال‌های شما کنید؛ تلگرام، بله و روبیکا.' },
  { n: '۳', title: 'بسازید و منتشر کنید', text: 'پست بنویسید، مقصدها را انتخاب کنید و الان یا زمان‌بندی‌شده منتشر کنید.' },
];

const FAQ = [
  { q: 'آیا برای ساخت ربات باید برنامه‌نویسی بلد باشم؟', a: 'خیر. پُست‌یار همهٔ کارها را بدون حتی یک خط کد انجام می‌دهد؛ ربات را با توکن رسمی پیام‌رسان وصل می‌کنید و همه‌چیز از پنل مدیریت می‌شود.' },
  { q: 'پست‌های زمان‌بندی‌شده چطور ارسال می‌شوند؟', a: 'پُست‌یار از موتور زمان‌بندی اختصاصی با صف ارسال، تلاش مجدد خودکار و گزارش دقیق وضعیت هر ارسال استفاده می‌کند تا هیچ پستی از دست نرود.' },
  { q: 'روبیکا واقعاً پشتیبانی می‌شود؟', a: 'بله؛ روبیکا مانند تلگرام و بله یک پلتفرم درجه اول در پُست‌یار است و آداپتور اختصاصی خودش را دارد.' },
  { q: 'اگر ارسال پیامی شکست بخورد چه می‌شود؟', a: 'وضعیت دقیق هر ارسال (موفق، در حال تلاش مجدد، ناموفق) را با دلیل آن می‌بینید و می‌توانید ارسال ناموفق را دوباره اجرا کنید.' },
];

const TRUST_CHIPS = [
  { Icon: TelegramIcon, label: 'کانال‌های خبری' },
  { Icon: RubikaIcon, label: 'فروشگاه‌های اینترنتی' },
  { Icon: BaleIcon, label: 'کانال‌های آموزشی' },
  { Icon: TelegramIcon, label: 'کسب‌وکارهای محلی' },
  { Icon: RubikaIcon, label: 'برندها و رسانه‌ها' },
];

const STATS: Array<{ to: number; prefix?: string; suffix?: string; label: string }> = [
  { to: 3, label: 'پیام‌رسان درجه یک، یک پنل' },
  { to: 50, prefix: '+', label: 'قابلیت حرفه‌ای' },
  { to: 24, suffix: '/۷', label: 'ارسال خودکار شبانه‌روزی' },
  { to: 100, suffix: '٪', label: 'رابط کاربری فارسی' },
];

/** Fade+rise scroll reveal (staggered via `delay`). */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -36px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`ln-reveal${inView ? ' ln-reveal--in' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Animated counter that starts when scrolled into view. */
function StatCounter({ to, prefix = '', suffix = '', label }: { to: number; prefix?: string; suffix?: string; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.disconnect();
          const t0 = performance.now();
          const duration = 1300;
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setValue(Math.round(eased * to));
            if (p < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          break;
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <div className="ln-stat" ref={ref}>
      <div className="ln-stat__value">{prefix}{faDigits(value)}{suffix}</div>
      <div className="ln-stat__label">{label}</div>
    </div>
  );
}

/** Smooth-height FAQ accordion (grid-rows transition, CSS-driven). */
function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="ln-faq">
      {FAQ.map((f, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={f.q} className={`ln-faq__item${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="ln-faq__q"
              id={`faq-q-${i}`}
              aria-expanded={isOpen}
              aria-controls={`faq-a-${i}`}
              onClick={() => setOpenIdx(isOpen ? null : i)}
            >
              <span>{f.q}</span>
              <svg className="ln-faq__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div className="ln-faq__a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
              <div className="ln-faq__a-inner"><p>{f.a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Plans from GET /api/v1/subscriptions/plans (same endpoint/shape as before),
 *  with loading skeleton and graceful fallback when the API is unreachable. */
function PricingGrid() {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/subscriptions/plans', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('plans-unavailable'))))
      .then((j: { data?: { plans?: PlanDto[] } }) => {
        if (!cancelled) setPlans(j.data?.plans ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error || (plans !== null && plans.length === 0)) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-2)', margin: 0 }}>
        برای مشاهدهٔ تعرفه‌ها و ثبت‌نام، وارد پنل کاربری شوید.
      </p>
    );
  }

  if (plans === null) {
    return (
      <div className="ln-pricing" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton ln-pricing-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="ln-pricing">
      {plans.map((p, i) => {
        const featured = p.code === 'professional';
        return (
          <Reveal key={p.id} delay={i * 90} className="ln-plan-reveal">
            <div className={`ln-plan${featured ? ' ln-plan--featured' : ''}`}>
              {featured && <span className="ln-plan__flag">پیشنهاد ما</span>}
              <h3 className="ln-plan__name">{p.nameFa}</h3>
              <div className="ln-plan__price">
                {p.priceRial === 0 ? 'رایگان' : faMoney(p.priceRial)}
                {p.priceRial > 0 && <span> / ماهانه</span>}
              </div>
              <ul className="ln-plan__list">
                <li>تا {p.limitsJson.max_channels === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_channels)} کانال`}</li>
                <li>{p.limitsJson.max_posts === 0 ? 'پست نامحدود' : `${faDigits(p.limitsJson.max_posts)} پست در دوره`}</li>
                <li>تا {p.limitsJson.max_bots === 0 ? 'نامحدود' : `${faDigits(p.limitsJson.max_bots)}`} ربات</li>
                <li className={p.featuresJson.gold_ticker ? undefined : 'is-off'}>ربات نرخ لحظه‌ای طلا و سکه</li>
                <li className={p.featuresJson.woocommerce ? undefined : 'is-off'}>اتصال ووکامرس</li>
              </ul>
              <a href="/?auth=register" className={`btn ${featured ? 'btn-primary' : 'btn-ghost'} btn-block ln-plan__cta`}>
                {p.priceRial === 0 ? 'شروع رایگان' : 'خرید اشتراک'}
              </a>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

/** Hand-built «product screenshot» mock — styled divs, fully RTL. */
function HeroMock() {
  return (
    <div className="ln-hero__mockwrap" aria-hidden="true">
      <div className="ln-floatchip ln-floatchip--sent">
        <span className="ln-floatchip__dot ln-floatchip__dot--green">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-11" /></svg>
        </span>
        ارسال موفق به ۴ کانال
      </div>
      <div className="ln-floatchip ln-floatchip--grow">
        <span className="ln-floatchip__dot ln-floatchip__dot--brand">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l5-6 4 3 7-8" /></svg>
        </span>
        +۱۲٪ تعامل این هفته
      </div>
      <div className="ln-mock">
        <div className="ln-mock__head">
          <Logo size={30} wordmarkSize={15} />
          <span className="ln-mock__chip">پنل انتشار</span>
        </div>
        <div className="ln-mock__caption" />
        <div className="ln-mock__caption ln-mock__caption--w80" />
        <div className="ln-mock__caption ln-mock__caption--w60" />
        <div className="ln-mock__chips">
          <span className="ln-mock__platform is-on"><TelegramIcon size={15} /> @khabar_daily</span>
          <span className="ln-mock__platform is-on"><BaleIcon size={15} /> فروشگاه ما</span>
          <span className="ln-mock__platform"><RubikaIcon size={15} /> آموزش‌نامه</span>
        </div>
        <div className="ln-mock__schedule">
          <NavIcon name="clock" size={15} />
          انتشار زمان‌بندی‌شده: امروز، ۱۸:۳۰
        </div>
        <div className="ln-mock__stats">
          <div className="ln-mock__stat"><b>۲٬۴۸۰</b><span>ارسال موفق</span></div>
          <div className="ln-mock__stat"><b>۱۴٫۲K</b><span>بازدید</span></div>
          <div className="ln-mock__stat"><b>۹۸٪</b><span>نرخ موفقیت</span></div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div>
      {/* ---------- Hero ---------- */}
      <section className="ln-hero">
        <div className="ln-hero__dots" aria-hidden="true" />
        <span className="ln-orb ln-orb--1" aria-hidden="true" />
        <span className="ln-orb ln-orb--2" aria-hidden="true" />
        <span className="ln-orb ln-orb--3" aria-hidden="true" />
        <div className="ln-hero__inner">
          <span className="ln-badge">
            <span className="ln-badge__pulse" aria-hidden="true" />
            همهٔ پیام‌رسان‌ها، یک پنل فارسی
          </span>
          <h1 className="ln-hero__title">
            مدیریت هوشمند و انتشار خودکار
            <br />
            در <span className="ln-hero__grad">تلگرام، بله و روبیکا</span>
          </h1>
          <p className="ln-hero__sub">
            یک‌بار بساز، همه‌جا منتشر کن. کانال‌ها، ربات‌ها، اتوماسیون، هوش مصنوعی و تحلیل آمار — همه در یک پنل.
          </p>
          <div className="ln-hero__ctas">
            <a href="/?auth=register" className="btn btn-primary btn-lg">ثبت‌نام رایگان</a>
            <a href="#features" className="btn btn-ghost btn-lg">مشاهده امکانات</a>
          </div>
          <div className="ln-hero__platforms">
            <span className="ln-platform-pill"><TelegramIcon size={20} /> تلگرام</span>
            <span className="ln-platform-pill"><BaleIcon size={20} /> بله</span>
            <span className="ln-platform-pill"><RubikaIcon size={20} /> روبیکا</span>
          </div>
        </div>
        <HeroMock />
      </section>

      {/* ---------- Trust strip ---------- */}
      <div className="ln-trust">
        <p className="ln-trust__title">مورد استفادهٔ مدیران کانال‌ها و فروشگاه‌های آنلاین</p>
        <div className="ln-trust__chips">
          {TRUST_CHIPS.map((c, i) => (
            <span key={i} className="ln-trust__chip">
              <c.Icon size={18} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* ---------- Features ---------- */}
      <section id="features" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">امکانات</span>
          <h2 className="ln-section__title">هر آنچه برای انتشار حرفه‌ای نیاز دارید</h2>
          <p className="ln-section__sub">از اتصال کانال تا تحلیل آمار؛ همه‌چیز یکجا</p>
        </div>
        <div className="ln-features">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 90}>
              <div className="ln-feature" style={{ height: '100%' }}>
                <div className="ln-feature__icon"><NavIcon name={f.icon} size={24} /></div>
                <h3 className="ln-feature__title">{f.title}</h3>
                <p className="ln-feature__text">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">روش استفاده</span>
          <h2 className="ln-section__title">در ۳ مرحلهٔ ساده شروع کنید</h2>
          <p className="ln-section__sub">بدون دانش فنی، بدون پیچیدگی</p>
        </div>
        <div className="ln-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="ln-step">
                <div className="ln-step__num" aria-hidden="true">{s.n}</div>
                <h3 className="ln-step__title">{s.title}</h3>
                <p className="ln-step__text">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- Stats band ---------- */}
      <section className="ln-section">
        <Reveal>
          <div className="ln-stats">
            {STATS.map((s) => (
              <StatCounter key={s.label} to={s.to} prefix={s.prefix} suffix={s.suffix} label={s.label} />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------- Platforms ---------- */}
      <section className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">پلتفرم‌ها</span>
          <h2 className="ln-section__title">پلتفرم‌های درجه اول</h2>
          <p className="ln-section__sub">تلگرام، بله و روبیکا؛ هرکدام با آداپتور اختصاصی و بدون محدودیت</p>
        </div>
        <div className="ln-features">
          {PLATFORM_CARDS.map((p, i) => (
            <Reveal key={p.name} delay={i * 90}>
              <div className="ln-feature" style={{ height: '100%' }}>
                <div className="ln-feature__icon"><p.Icon size={28} /></div>
                <h3 className="ln-feature__title">{p.name}</h3>
                <p className="ln-feature__text">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- Advanced integrations ---------- */}
      <section className="ln-section">
        <div className="ln-rows">
          <Reveal>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon"><NavIcon name="woocommerce" size={22} /></div>
              <div>
                <h3 className="ln-row__title">یکپارچگی با ووکامرس</h3>
                <p className="ln-row__text">محصولات فروشگاه ووکامرسی شما به‌صورت خودکار به کانال‌ها منتشر می‌شود؛ همگام‌سازی قیمت و موجودی.</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon"><NavIcon name="gold" size={22} /></div>
              <div>
                <h3 className="ln-row__title">ربات نرخ لحظه‌ای طلا و سکه</h3>
                <p className="ln-row__text">نرخ طلا، سکه و ارز را به‌صورت خودکار و زمان‌بندی‌شده در کانال شما منتشر کنید.</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="ln-row" style={{ height: '100%' }}>
              <div className="ln-row__icon"><NavIcon name="workflows" size={22} /></div>
              <div>
                <h3 className="ln-row__title">اتوماسیون و گردش‌کار</h3>
                <p className="ln-row__text">پاسخ‌های خودکار، دستورهای ربات و گردش‌کارهای چندمرحله‌ای بدون کدنویسی.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section id="pricing" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">تعرفه‌ها</span>
          <h2 className="ln-section__title">تعرفه‌های پُست‌یار</h2>
          <p className="ln-section__sub">با پلن رایگان شروع کنید؛ هر وقت خواستید ارتقا دهید</p>
        </div>
        <PricingGrid />
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="ln-section">
        <div className="ln-section__head">
          <span className="ln-section__kicker">سؤالات متداول</span>
          <h2 className="ln-section__title">پاسخ پرتکرارترین پرسش‌ها</h2>
        </div>
        <Reveal>
          <Faq />
        </Reveal>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="ln-section ln-section--flush">
        <Reveal>
          <div className="ln-cta">
            <h2 className="ln-cta__title">همین امروز انتشار حرفه‌ای را شروع کنید</h2>
            <p className="ln-cta__sub">حساب رایگان بسازید؛ بدون نیاز به کارت بانکی.</p>
            <div className="ln-cta__btns">
              <a href="/?auth=register" className="btn btn-primary btn-lg">ساخت حساب رایگان</a>
              <a href="/?auth=login" className="btn btn-ghost btn-lg">ورود به حساب</a>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
