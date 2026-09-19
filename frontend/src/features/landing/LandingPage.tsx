import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  PenLine,
  Plug,
  Puzzle,
  Rocket,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../../components/Logo';
import { get } from '../../lib/api';
import { cn } from '../../lib/cn';
import { faMoney, toFa, toJalali } from '../../lib/format';
import { usePageTitle } from '../../app/usePageTitle';
import { useUiStore } from '../../store/ui';
import {
  BaleIcon,
  CountUp,
  Reveal,
  RubikaIcon,
  ScrollProgress,
  SectionHead,
  TelegramIcon,
  scrollToAnchor,
  useTilt,
} from './landingParts';

/**
 * Postyar public landing page — 2026 redesign (task 10-b).
 *
 * Dark stone/teal glass design language matching the dashboard shell:
 * floating glass header, aurora hero with tilt frame + floating mini-cards,
 * hand-crafted messenger brand SVGs (Telegram / Bale / Rubika), bento feature
 * grid, IntersectionObserver count-up stats, scroll-reveal steps, testimonials,
 * real plan cards from the public GET /plans endpoint, animated FAQ accordion,
 * final CTA and rich footer. Zero new dependencies — CSS keyframes + observers.
 * All motion is disabled under prefers-reduced-motion (index.css override).
 */

interface PlanTeaser {
  id: number | string;
  code?: string;
  name?: string;
  description?: string | null;
  priceMonthly?: number;
  limits?: Record<string, number>;
}

type MessengerIcon = ComponentType<{ className?: string }>;

/* ------------------------------ page data ------------------------------ */

const NAV_LINKS = [
  { id: 'features', label: 'امکانات' },
  { id: 'channels', label: 'پیام‌رسان‌ها' },
  { id: 'how', label: 'نحوهٔ کار' },
  { id: 'pricing', label: 'تعرفه‌ها' },
  { id: 'faq', label: 'سؤالات متداول' },
] as const;

const FAQ_ITEMS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'پُست‌یار دقیقاً چه کاری برای من انجام می‌دهد؟',
    a: 'پُست‌یار یک پنل واحد برای ساخت، زمان‌بندی و انتشار محتوا در تلگرام، بله و روبیکا است. یک بار پست می‌سازید و همان محتوا هم‌زمان در همهٔ کانال‌های انتخابی شما منتشر می‌شود؛ ربات‌ها هم به پیام‌ها پاسخ می‌دهند و نرخ طلا یا محصولات فروشگاه می‌تواند به‌صورت خودکار پست شود.',
  },
  {
    q: 'آیا برای اتصال کانال باید ربات مدیر کانال شود؟',
    a: 'بله. برای انتشار در یک کانال، ربات پُست‌یار باید در آن کانال مدیر باشد و اجازهٔ ارسال پیام داشته باشد. اطلاعات اتصال به‌صورت رمزنگاری‌شده ذخیره می‌شود و کلیدهای شما هرگز نمایش داده نمی‌شوند.',
  },
  {
    q: 'اگر اینترنت قطع شود یا پیامی ارسال نشود چه می‌شود؟',
    a: 'هر ارسال تا ۵ بار با فاصلهٔ زمانی خودکار تلاش مجدد می‌شود و در صورت ناموفق‌بودن، وضعیت دقیق آن با دلیل خطا در بخش انتشار نمایش داده می‌شود؛ می‌توانید با یک کلیک ارسال را دوباره تلاش کنید.',
  },
  {
    q: 'هوش مصنوعی چگونه محاسبه می‌شود؟',
    a: 'هر درخواست بسته به طول متن، اعتبار مشخصی از سهمیهٔ ماهانهٔ پلن شما مصرف می‌کند. مصرفِ روز و سهمیهٔ باقی‌مانده همیشه در داشبورد قابل مشاهده است و در صورت اتمام سهمیه می‌توانید پلن را ارتقا دهید.',
  },
  {
    q: 'درگاه پرداخت و بازگشت وجه چگونه است؟',
    a: 'پرداخت‌ها از طریق درگاه‌های بانکی معتبر انجام می‌شود و اشتراک بلافاصله پس از تأیید فعال می‌گردد. اگر پرداختی ناموفق ثبت شود و مبلغی کسر شده باشد، به‌صورت خودکار به حساب شما بازگردانده می‌شود.',
  },
];

const STATS: ReadonlyArray<{ to: number; decimals: number; label: string; suffix?: string }> = [
  { to: 128400, decimals: 0, label: 'پست منتشرشده تا امروز' },
  { to: 98.6, decimals: 1, label: 'نرخ موفقیت ارسال', suffix: '٪' },
  { to: 3200, decimals: 0, label: 'کانال متصل به پنل' },
  { to: 1150, decimals: 0, label: 'ربات پاسخ‌گوی فعال' },
];

const STEPS: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: Plug,
    title: 'کانال‌ها را متصل کنید',
    text: 'ربات پُست‌یار را به کانال‌های تلگرام، بله و روبیکا دعوت کنید؛ اتصال امن و رمزنگاری‌شده در کمتر از دو دقیقه انجام می‌شود.',
  },
  {
    icon: PenLine,
    title: 'محتوا را بسازید و زمان‌بندی کنید',
    text: 'با دستیار هوش مصنوعی متن بنویسید، تصویر بچسبانید و با تقویم شمسی، یک بار برای همهٔ کانال‌ها زمان‌بندی کنید.',
  },
  {
    icon: Rocket,
    title: 'بقیه‌اش با پُست‌یار',
    text: 'موتور انتشار، تلاش مجدد هوشمند و گزارش‌های زنده کار را تمام می‌کنند؛ شما فقط نتیجه را در داشبورد ببینید.',
  },
];

const TESTIMONIALS: ReadonlyArray<{ initial: string; name: string; role: string; tone: string; text: string }> = [
  {
    initial: 'ت',
    name: 'تارا محمدی',
    role: 'مدیر کانال خبری فناوری',
    tone: 'from-primary-500 to-emerald-500',
    text: 'قبل از پُست‌یار هر روز برای سه کانال، سه بار پست می‌ساختم. حالا یک بار می‌نویسم و زمان‌بندی می‌کنم؛ تازه گزارش دقیق هم دارم که چه ساعتی بیشترین بازخورد را می‌گیرد.',
  },
  {
    initial: 'س',
    name: 'سعید کریمی',
    role: 'بنیان‌گذار فروشگاه اینترنتی',
    tone: 'from-accent-500 to-orange-500',
    text: 'سینک ووکامرس عالی است؛ محصول جدید که اضافه می‌شود، پست آماده با قیمت ریالی و لینک مستقیم در کانال منتشر می‌شود. فروش از کانال تقریباً دو برابر شده.',
  },
  {
    initial: 'م',
    name: 'مریم احمدی',
    role: 'ادمین کانال بازار طلا',
    tone: 'from-violet-500 to-fuchsia-500',
    text: 'پست خودکار نرخ طلا با تاریخ شمسی و قالب دلخواه، بدون اینکه دستم به کامپیوتر بخورد. انگار یک کارمند تمام‌وقت دارم که هیچ‌وقت خسته نمی‌شود.',
  },
];

const PLAN_LIMIT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['channels', 'کانال'],
  ['postsPerMonth', 'پست در ماه'],
  ['aiCredits', 'اعتبار هوش مصنوعی'],
  ['bots', 'ربات'],
];

/* ------------------------------ tiny parts ------------------------------ */

const ICON_TONES = {
  teal: 'border-primary-400/30 bg-gradient-to-br from-primary-500/25 to-primary-500/5 text-primary-300',
  emerald: 'border-emerald-400/30 bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-300',
  amber: 'border-accent-400/30 bg-gradient-to-br from-accent-500/25 to-accent-500/5 text-accent-300',
  violet: 'border-violet-400/30 bg-gradient-to-br from-violet-500/25 to-violet-500/5 text-violet-300',
  sky: 'border-sky-400/30 bg-gradient-to-br from-sky-500/25 to-sky-500/5 text-sky-300',
  rose: 'border-rose-400/30 bg-gradient-to-br from-rose-500/25 to-rose-500/5 text-rose-300',
} as const;
type IconTone = keyof typeof ICON_TONES;

function BentoCard({
  icon: Icon,
  tone,
  title,
  text,
  className,
  children,
}: {
  icon: LucideIcon;
  tone: IconTone;
  title: string;
  text: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm',
        'transition-all duration-300 hover:-translate-y-1 hover:border-primary-400/40 hover:shadow-[0_24px_70px_-24px_rgba(20,184,166,0.45)] sm:p-7',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-20 -top-20 size-44 rounded-full bg-primary-400/15 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <span className={cn('inline-flex size-12 items-center justify-center rounded-2xl border', ICON_TONES[tone])}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h3 className="mt-4 text-base font-bold text-stone-50 sm:text-lg">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-stone-400">{text}</p>
      {children}
    </div>
  );
}

/* ------------------------------- header -------------------------------- */

function SiteHeader() {
  const openAuthModal = useUiStore((s) => s.openAuthModal);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 12));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={cn(
          'mx-auto flex h-14 max-w-5xl items-center gap-2 rounded-2xl border px-3 transition-all duration-300 sm:h-16 sm:gap-3 sm:px-5',
          scrolled
            ? 'border-white/10 bg-stone-900/85 shadow-lg shadow-black/40 backdrop-blur-xl'
            : 'border-white/5 bg-stone-900/40 backdrop-blur-md',
        )}
      >
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            scrollToAnchor('top');
          }}
          className="focus-ring flex shrink-0 items-center gap-2.5 rounded-xl"
          aria-label="پُست‌یار — صفحهٔ اصلی"
        >
          <Logo variant="square" />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-base font-bold text-stone-50">پُست‌یار</span>
            <span className="text-[10px] text-stone-400">پلتفرم انتشار چندکاناله</span>
          </span>
        </a>

        <nav aria-label="فهرست صفحهٔ اصلی" className="mx-auto hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToAnchor(link.id);
              }}
              className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <button
            type="button"
            onClick={() => openAuthModal('login')}
            className="focus-ring hidden h-9 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-medium text-stone-200 transition-colors hover:bg-white/10 sm:inline-flex"
          >
            ورود
          </button>
          <button
            type="button"
            onClick={() => openAuthModal('register')}
            className="focus-ring inline-flex h-9 items-center rounded-xl bg-gradient-to-l from-primary-500 to-emerald-500 px-3 text-sm font-bold text-stone-950 shadow-[0_8px_24px_-8px_rgba(20,184,166,0.7)] transition-all hover:brightness-110 sm:px-5"
          >
            شروع رایگان
          </button>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------- hero --------------------------------- */

const GRID_OVERLAY_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(to left, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
  backgroundSize: '44px 44px',
  maskImage: 'radial-gradient(ellipse 65% 55% at 50% 18%, black, transparent 72%)',
  WebkitMaskImage: 'radial-gradient(ellipse 65% 55% at 50% 18%, black, transparent 72%)',
};

const FLOAT_CARDS: ReadonlyArray<{
  icon: LucideIcon;
  tone: string;
  title: string;
  sub: string;
  pos: string;
  anim: string;
  show: string;
}> = [
  {
    icon: Send,
    tone: 'border-primary-400/30 bg-primary-500/15 text-primary-300',
    title: 'انتشار خودکار',
    sub: 'هم‌زمان در ۳ پیام‌رسان',
    pos: '-top-5 start-2 sm:-start-5 lg:-start-10',
    anim: 'lp-float',
    show: 'hidden sm:flex',
  },
  {
    icon: TrendingUp,
    tone: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
    title: '۴۸٪ رشد',
    sub: 'میانگین بازدید ماهانه',
    pos: 'top-1/3 -end-2 sm:-end-6 lg:-end-12',
    anim: 'lp-float-alt',
    show: 'hidden sm:flex',
  },
  {
    icon: CalendarClock,
    tone: 'border-accent-400/30 bg-accent-500/15 text-accent-300',
    title: 'زمان‌بندی شمسی',
    sub: 'دقیق تا هر دقیقه',
    pos: '-bottom-6 start-3 lg:-start-8',
    anim: 'lp-float-alt',
    show: 'hidden lg:flex',
  },
  {
    icon: Bot,
    tone: 'border-violet-400/30 bg-violet-500/15 text-violet-300',
    title: 'ربات پاسخ‌گو',
    sub: 'آنلاین ۲۴ ساعته',
    pos: '-bottom-7 end-3 lg:-end-8',
    anim: 'lp-float',
    show: 'hidden lg:flex',
  },
];

const INTEGRATIONS: ReadonlyArray<{ label: string; icon: ReactNode }> = [
  { label: 'تلگرام', icon: <TelegramIcon className="size-4" /> },
  { label: 'بله', icon: <BaleIcon className="size-4" /> },
  { label: 'روبیکا', icon: <RubikaIcon className="size-4" /> },
  { label: 'وردپرس', icon: <Puzzle aria-hidden="true" className="size-4 text-stone-300" /> },
  { label: 'ووکامرس', icon: <ShoppingBag aria-hidden="true" className="size-4 text-stone-300" /> },
];

function Hero({ onRegister }: { onRegister: () => void }) {
  const tiltRef = useTilt<HTMLDivElement>(4);

  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pt-36 lg:pb-28" aria-labelledby="hero-title">
      {/* layered background: network glow image + aurora blobs + grid */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <img
          src="/images/landing-bg.png"
          alt=""
          width={1344}
          height={768}
          decoding="async"
          className="absolute inset-x-0 top-0 mx-auto h-auto w-full max-w-6xl opacity-25 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_30%,transparent_75%)]"
        />
        <div className="lp-aurora absolute -top-24 start-[6%] size-72 rounded-full bg-primary-500/20 blur-3xl sm:size-96" />
        <div className="lp-aurora absolute top-44 end-[4%] size-64 rounded-full bg-emerald-500/15 blur-3xl [animation-delay:-6s] sm:size-80" />
        <div className="lp-aurora absolute top-[30rem] start-[36%] size-64 rounded-full bg-accent-500/10 blur-3xl [animation-delay:-12s]" />
        <div className="absolute inset-0" style={GRID_OVERLAY_STYLE} />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 lg:px-8">
        <Reveal className="flex justify-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-stone-300 backdrop-blur">
            <Sparkles aria-hidden="true" className="size-4 text-accent-400" />
            پلتفرم هوشمند انتشار در پیام‌رسان‌های ایرانی
            <span className="hidden rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 sm:inline">
              نسخهٔ ۱۴۰۵
            </span>
          </p>
        </Reveal>

        <Reveal delay={80}>
          <h1
            id="hero-title"
            className="mx-auto mt-6 max-w-3xl text-center text-3xl font-bold leading-[1.35] text-stone-50 sm:text-5xl sm:leading-[1.3] lg:text-[3.5rem] lg:leading-[1.25]"
          >
            یک بار بساز،{' '}
            <span className="bg-gradient-to-l from-primary-300 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
              همه‌جا منتشر کن
            </span>
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-8 text-stone-400 sm:text-base sm:leading-9">
            پُست‌یار پنل فارسی مدیریت محتواست: پست‌هایتان را یک‌جا بنویسید و هم‌زمان در تلگرام، بله و روبیکا منتشر
            کنید؛ ربات پاسخ‌گو بسازید، نرخ طلا و محصولات فروشگاه را خودکار پست کنید و همه‌چیز را با گزارش‌های شفاف
            زیر نظر بگیرید.
          </p>
        </Reveal>

        <Reveal delay={220}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRegister}
              className="lp-shine group inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-l from-primary-500 via-primary-400 to-emerald-400 px-7 text-base font-bold text-stone-950 shadow-[0_12px_40px_-10px_rgba(20,184,166,0.6)] transition-all duration-300 hover:shadow-[0_16px_50px_-8px_rgba(20,184,166,0.8)] hover:brightness-110"
            >
              شروع رایگان
              <ArrowLeft
                aria-hidden="true"
                className="size-4 transition-transform duration-300 group-hover:-translate-x-1"
              />
            </button>
            <a
              href="#pricing"
              onClick={(e) => {
                e.preventDefault();
                scrollToAnchor('pricing');
              }}
              className="focus-ring inline-flex h-12 items-center rounded-2xl border border-white/15 bg-white/5 px-7 text-base font-medium text-stone-200 backdrop-blur transition-colors hover:border-white/25 hover:bg-white/10"
            >
              مشاهده تعرفه‌ها
            </a>
          </div>
        </Reveal>

        <Reveal delay={280}>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-stone-400 sm:text-sm">
            {['بدون نیاز به کارت بانکی', 'راه‌اندازی زیر ۲ دقیقه', 'تقویم و اعداد کاملاً فارسی'].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check aria-hidden="true" className="size-4 text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* product visual: glass frame + tilt + floating mini-cards */}
        <Reveal delay={340} className="relative mx-auto mt-16 max-w-4xl">
          <div
            aria-hidden="true"
            className="absolute -inset-x-8 -top-12 bottom-0 -z-10 rounded-[3rem] bg-gradient-to-b from-primary-500/25 via-primary-500/5 to-transparent blur-2xl"
          />
          <div ref={tiltRef} className="lp-tilt relative">
            <div className="rounded-[2rem] bg-gradient-to-b from-white/20 via-white/10 to-white/5 p-[1px] shadow-[0_40px_120px_-30px_rgba(20,184,166,0.35)]">
              <div className="overflow-hidden rounded-[calc(2rem-1px)] border border-white/10 bg-stone-900/70 backdrop-blur-xl">
                <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.03] px-4 py-3">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-rose-400/70" />
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-accent-400/70" />
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-400/70" />
                  <span
                    dir="ltr"
                    className="ms-3 rounded-lg border border-white/5 bg-black/30 px-3 py-1 text-[10px] text-stone-400"
                  >
                    app.postyar.ir
                  </span>
                  <span className="ms-auto hidden items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 sm:flex">
                    <span aria-hidden="true" className="lp-pulse-dot size-1.5 rounded-full bg-emerald-300" />
                    موتور انتشار فعال
                  </span>
                </div>
                <img
                  src="/images/landing-hero.png"
                  alt="نمای سه‌بعدی داشبورد پُست‌یار در کنار هواپیماهای کاغذی، نماد انتشار هم‌زمان در چند پیام‌رسان"
                  width={1344}
                  height={768}
                  decoding="async"
                  className="h-auto w-full"
                />
              </div>
            </div>

            {FLOAT_CARDS.map((card) => (
              <div
                key={card.title}
                aria-hidden="true"
                className={cn(
                  'absolute z-10 items-center gap-2.5 rounded-2xl border border-white/10 bg-stone-900/85 px-3.5 py-2.5 shadow-xl shadow-black/30 backdrop-blur-xl',
                  card.pos,
                  card.anim,
                  card.show,
                )}
              >
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl border', card.tone)}>
                  <card.icon className="size-4.5" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-xs font-bold text-stone-50 sm:text-sm">{card.title}</span>
                  <span className="mt-0.5 text-[10px] text-stone-400 sm:text-[11px]">{card.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={400}>
          <ul className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
            {INTEGRATIONS.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-stone-300 backdrop-blur"
              >
                {item.icon}
                {item.label}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------ channels ------------------------------- */

const CHANNELS: ReadonlyArray<{
  id: string;
  name: string;
  Icon: MessengerIcon;
  tagline: string;
  points: readonly string[];
  note: string | null;
  glow: string;
  hover: string;
}> = [
  {
    id: 'telegram',
    name: 'تلگرام',
    Icon: TelegramIcon,
    tagline: 'اتصال با Bot API رسمی',
    points: [
      'انتشار در کانال و سوپرگروپ',
      'ویرایش و حذف پیام پس از ارسال',
      'دکمه‌های شیشه‌ای و منوی ربات',
    ],
    note: null,
    glow: 'shadow-[0_14px_44px_-14px_rgba(34,158,217,0.7)]',
    hover: 'hover:border-[#229ED9]/50 hover:shadow-[0_26px_70px_-26px_rgba(34,158,217,0.45)]',
  },
  {
    id: 'bale',
    name: 'بله',
    Icon: BaleIcon,
    tagline: 'ربات رسمی پیام‌رسان بله',
    points: ['انتشار پست در کانال‌های بله', 'ربات پاسخ‌گو با دستورهای کوتاه', 'زمان‌بندی و تکرار مانند تلگرام'],
    note: null,
    glow: 'shadow-[0_14px_44px_-14px_rgba(31,160,90,0.7)]',
    hover: 'hover:border-emerald-400/50 hover:shadow-[0_26px_70px_-26px_rgba(31,160,90,0.45)]',
  },
  {
    id: 'rubika',
    name: 'روبیکا',
    Icon: RubikaIcon,
    tagline: 'انتشار مطمئن در روبیکا',
    points: ['انتشار پست در کانال‌های روبیکا', 'زمان‌بندی و گزارش وضعیت هر ارسال'],
    note: 'در روبیکا ویرایش پیام پس از ارسال پشتیبانی نمی‌شود؛ متن نهایی را پیش از انتشار بازبینی کنید.',
    glow: 'shadow-[0_14px_44px_-14px_rgba(109,40,217,0.7)]',
    hover: 'hover:border-violet-400/50 hover:shadow-[0_26px_70px_-26px_rgba(109,40,217,0.45)]',
  },
];

function Channels() {
  return (
    <section id="channels" className="scroll-mt-24 py-20 lg:py-28" aria-label="پیام‌رسان‌های پشتیبانی‌شده">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <SectionHead
          eyebrow="پیام‌رسان‌های رسمی"
          title={
            <>
              متصل شوید به{' '}
              <span className="bg-gradient-to-l from-sky-300 via-emerald-300 to-violet-300 bg-clip-text text-transparent">
                تلگرام، بله و روبیکا
              </span>
            </>
          }
          description="هر سه پیام‌رسان با اتصال رسمی ربات پشتیبانی می‌شوند؛ یک پنل، سه کانال انتشار و گزارش وضعیت جداگانه برای هر کدام."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {CHANNELS.map((channel, i) => (
            <Reveal key={channel.id} delay={i * 100} className="h-full">
              <article
                className={cn(
                  'group flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1.5',
                  channel.hover,
                )}
              >
                <div className="flex items-center gap-4">
                  <channel.Icon
                    className={cn('size-14 shrink-0 transition-transform duration-300 group-hover:scale-110', channel.glow)}
                  />
                  <div>
                    <h3 className="text-lg font-bold text-stone-50">{channel.name}</h3>
                    <p className="mt-0.5 text-xs font-medium text-stone-400">{channel.tagline}</p>
                  </div>
                </div>
                <ul className="mt-6 space-y-2.5">
                  {channel.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm leading-6 text-stone-300">
                      <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-400" />
                      {point}
                    </li>
                  ))}
                </ul>
                {channel.note && (
                  <p className="mt-4 rounded-xl border border-accent-400/20 bg-accent-500/10 px-3 py-2 text-[11px] leading-5 text-accent-200">
                    {channel.note}
                  </p>
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- bento --------------------------------- */

function Features() {
  return (
    <section id="features" className="scroll-mt-24 py-20 lg:py-28" aria-label="امکانات پُست‌یار">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <SectionHead
          eyebrow="امکانات"
          title="هر چیزی که برای انتشار حرفه‌ای لازم دارید"
          description="از ساختن و زمان‌بندی محتوا تا اتوماسیون فروش و گزارش دقیق — همه در یک پنل فارسی."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Reveal className="h-full sm:col-span-2">
            <BentoCard
              icon={Send}
              tone="teal"
              title="انتشار هم‌زمان چندکاناله"
              text="یک پیام را بنویسید و در همهٔ کانال‌های تلگرام، بله و روبیکا منتشر کنید؛ صف ارسال تضمین‌شده با تلاش مجدد خودکار تا ۵ بار، هیچ پستی را گم نمی‌کند."
              className="h-full"
            >
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                {['تلگرام', 'بله', 'روبیکا', 'همه با هم'].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-stone-300"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </BentoCard>
          </Reveal>

          <Reveal delay={80} className="h-full">
            <BentoCard
              icon={CalendarClock}
              tone="amber"
              title="زمان‌بندی هوشمند جلالی"
              text="تقویم شمسی و ساعت تهران؛ تکرار روزانه، هفتگی و ماهانه بدون ثبت مجدد و توقف و ادامهٔ لحظه‌ای زمان‌بندی‌ها."
              className="h-full"
            />
          </Reveal>

          <Reveal delay={140} className="h-full">
            <BentoCard
              icon={Sparkles}
              tone="violet"
              title="دستیار محتوای هوش مصنوعی"
              text="کپی‌رایتینگ تبلیغاتی، خلاصه‌سازی و پاسخ‌گویی خودکار با انتخاب مدل؛ سهمیهٔ شفاف و تاریخچهٔ کامل خروجی‌ها."
              className="h-full"
            />
          </Reveal>

          <Reveal delay={80} className="h-full sm:col-span-2">
            <BentoCard
              icon={Bot}
              tone="emerald"
              title="اتوماسیون و ربات‌ساز"
              text="گردش‌کارهای چندمرحله‌ای با دکمه، شرط و انتظار؛ ربات‌های پاسخ‌گو با دستورهای کوتاه و پاسخ خودکار هوش مصنوعی."
              className="h-full"
            >
              <img
                src="/images/landing-flow.png"
                alt="نمای ایزومتریک گردش‌کار اتوماسیون انتشار محتوا در پُست‌یار"
                width={1152}
                height={864}
                loading="lazy"
                decoding="async"
                className="mt-6 h-44 w-full rounded-2xl border border-white/10 object-cover sm:h-52 lg:h-60"
              />
            </BentoCard>
          </Reveal>

          <Reveal delay={140} className="h-full">
            <BentoCard
              icon={ShoppingBag}
              tone="sky"
              title="سینک ووکامرس و نرخ طلا"
              text="محصولات با قیمت و موجودی از سایت به پنل می‌آیند و نرخ طلا، سکه و ارز در تناوب دلخواه خودکار پست می‌شود."
              className="h-full"
            />
          </Reveal>

          <Reveal delay={200} className="h-full">
            <BentoCard
              icon={Puzzle}
              tone="rose"
              title="افزونهٔ وردپرس"
              text="با افزونهٔ اختصاصی، محصولات وردپرس در لحظه به پنل می‌رسند؛ اتصال امن با کلید اختصاصی و امضای رمزنگاری‌شده (HMAC)."
              className="h-full"
            />
          </Reveal>

          <Reveal className="h-full sm:col-span-2">
            <BentoCard
              icon={BarChart3}
              tone="teal"
              title="گزارش‌های زنده و شفاف"
              text="نمودار روزانهٔ ارسال‌های موفق و ناموفق، مقایسهٔ کانال‌ها و ربات‌ها و مصرف اعتبار — همه با اعداد فارسی و تقویم شمسی."
              className="h-full"
            >
              <div aria-hidden="true" className="mt-auto flex h-20 items-end gap-1.5 pt-5">
                {[38, 62, 45, 80, 58, 92, 70, 84].map((height, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-md bg-gradient-to-t from-primary-600/40 to-primary-400/80 transition-all duration-300 group-hover:to-emerald-400/90"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </BentoCard>
          </Reveal>

          <Reveal delay={80} className="h-full sm:col-span-2">
            <BentoCard
              icon={ShieldCheck}
              tone="emerald"
              title="کیف پول، پرداخت و امنیت"
              text="پرداخت با درگاه‌های بانکی معتبر و کیف پول داخلی؛ رمزها و توکن‌ها رمزنگاری‌شده نگهداری می‌شوند و هر عملیات حساس در گزارش رخدادها ثبت می‌شود."
              className="h-full"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- stats -------------------------------- */

function StatsStrip() {
  return (
    <section className="py-6 lg:py-10" aria-label="آمار پلتفرم">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 lg:grid-cols-4">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center gap-1.5 bg-stone-950/80 px-4 py-8 text-center backdrop-blur"
              >
                <dt className="order-2 text-xs font-medium text-stone-400 sm:text-sm">{stat.label}</dt>
                <dd className="order-1 text-2xl font-bold text-stone-50 sm:text-3xl">
                  <CountUp to={stat.to} decimals={stat.decimals} />
                  {stat.suffix && <span className="text-xl text-primary-300 sm:text-2xl">{stat.suffix}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------- how it works ---------------------------- */

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 py-20 lg:py-28" aria-label="نحوهٔ کار با پُست‌یار">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <SectionHead
          eyebrow="نحوهٔ کار"
          title="در سه قدم راه بیندازید"
          description="از اتصال کانال تا اولین انتشار خودکار، کمتر از ده دقیقه فاصله است."
        />
        <ol className="relative mx-auto mt-14 grid max-w-4xl gap-10 md:grid-cols-3 md:gap-6">
          <span
            aria-hidden="true"
            className="absolute inset-x-16 top-8 hidden h-px bg-gradient-to-l from-transparent via-primary-400/50 to-transparent md:block"
          />
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Reveal delay={i * 120} className="relative flex h-full flex-col items-center text-center">
                <div className="relative">
                  <span className="flex size-16 items-center justify-center rounded-2xl border border-primary-400/30 bg-gradient-to-br from-primary-500/20 to-stone-900 shadow-[0_12px_36px_-12px_rgba(20,184,166,0.5)]">
                    <step.icon aria-hidden="true" className="size-7 text-primary-300" />
                  </span>
                  <span className="absolute -end-2 -top-2 flex size-6 items-center justify-center rounded-full border border-primary-400/40 bg-stone-900 text-xs font-bold text-primary-300">
                    {toFa(i + 1)}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-bold text-stone-50">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-stone-400">{step.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------- testimonials ----------------------------- */

function Testimonials() {
  return (
    <section
      className="border-y border-white/5 bg-white/[0.02] py-20 lg:py-28"
      aria-label="نظر کاربران پُست‌یار"
    >
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <SectionHead
          eyebrow="اعتماد کاربران"
          title="کسب‌وکارهایی که روزشان ساده شده"
          description="از کانال‌های خبری تا فروشگاه‌های اینترنتی و کانال‌های بازار طلا."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((item, i) => (
            <Reveal key={item.name} delay={i * 100} className="h-full">
              <figure className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition-colors duration-300 hover:border-white/20">
                <div className="flex items-center gap-1" aria-label="امتیاز پنج از پنج">
                  {Array.from({ length: 5 }, (_, star) => (
                    <Star key={star} aria-hidden="true" className="size-4 fill-accent-400 text-accent-400" />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 text-sm leading-8 text-stone-300">«{item.text}»</blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-white/5 pt-5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-base font-bold text-white',
                      item.tone,
                    )}
                  >
                    {item.initial}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-bold text-stone-50">{item.name}</span>
                    <span className="mt-1 text-xs text-stone-400">{item.role}</span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- pricing ------------------------------- */

function Pricing({ onRegister }: { onRegister: () => void }) {
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => get<{ items?: PlanTeaser[] }>('/plans'),
  });

  const items = plans.data?.items ?? [];
  const proIndex = items.findIndex((plan) => plan.code === 'PRO');
  const popularIndex = proIndex >= 0 ? proIndex : items.length >= 3 ? 1 : -1;

  return (
    <section id="pricing" className="scroll-mt-24 py-20 lg:py-28" aria-label="تعرفه‌های پُست‌یار">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <SectionHead
          eyebrow="تعرفه‌ها"
          title="پلنی برای هر اندازه کسب‌وکار"
          description="با پلن رایگان شروع کنید و هر وقت بزرگ‌تر شدید ارتقا دهید؛ قیمت‌ها ماهانه و به ریال است."
        />

        {plans.isLoading ? (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />
            ))}
          </div>
        ) : plans.error ? (
          <Reveal className="mt-12 text-center">
            <p className="text-sm text-stone-400">
              بارگذاری تعرفه‌ها ناموفق بود؛{' '}
              <button
                type="button"
                onClick={() => void plans.refetch()}
                className="focus-ring font-bold text-primary-300 underline underline-offset-4"
              >
                تلاش مجدد
              </button>
            </p>
          </Reveal>
        ) : (
          <div className="mt-12 grid gap-5 pt-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((plan, i) => {
              const popular = i === popularIndex;
              return (
                <Reveal key={String(plan.id)} delay={i * 90} className="h-full">
                  <article
                    className={cn(
                      'relative flex h-full flex-col rounded-3xl border p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 sm:p-7',
                      popular
                        ? 'border-primary-400/60 bg-gradient-to-b from-primary-500/15 to-stone-950/80 shadow-[0_30px_80px_-24px_rgba(20,184,166,0.45)]'
                        : 'border-white/10 bg-white/[0.04] hover:border-white/20',
                    )}
                  >
                    {popular && (
                      <span className="absolute -top-3.5 start-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-l from-primary-500 to-emerald-500 px-4 py-1 text-xs font-bold text-stone-950 shadow-lg rtl:translate-x-1/2">
                        محبوب‌ترین پلن
                      </span>
                    )}
                    <h3 className="text-lg font-bold text-stone-50">{plan.name || plan.code}</h3>
                    {plan.description && (
                      <p className="mt-1.5 text-xs leading-6 text-stone-400">{plan.description}</p>
                    )}
                    <p className="mt-4 flex items-baseline gap-1.5">
                      {typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0 ? (
                        <>
                          <span className="text-2xl font-bold text-stone-50">{faMoney(plan.priceMonthly)}</span>
                          <span className="text-xs text-stone-500">/ ماه</span>
                        </>
                      ) : (
                        <span className="text-2xl font-bold text-emerald-300">رایگان</span>
                      )}
                    </p>
                    <ul className="mt-5 flex-1 space-y-2 border-t border-white/5 pt-5">
                      {PLAN_LIMIT_ROWS.map(([key, label]) => (
                        <li key={key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-stone-400">{label}</span>
                          <span className="font-bold text-stone-200">{toFa(plan.limits?.[key] ?? 0)}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={onRegister}
                      className={cn(
                        'focus-ring mt-6 inline-flex h-11 items-center justify-center rounded-xl text-sm font-bold transition-all',
                        popular
                          ? 'bg-gradient-to-l from-primary-500 to-emerald-500 text-stone-950 hover:brightness-110'
                          : 'border border-white/15 bg-white/5 text-stone-100 hover:bg-white/10',
                      )}
                    >
                      انتخاب پلن {plan.name || plan.code}
                    </button>
                  </article>
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* --------------------------------- FAQ --------------------------------- */

function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="scroll-mt-24 border-y border-white/5 bg-white/[0.02] py-20 lg:py-28"
      aria-label="سؤالات متداول"
    >
      <div className="mx-auto w-full max-w-3xl px-4 lg:px-8">
        <SectionHead eyebrow="سؤالات متداول" title="پاسخ پرتکرارترین پرسش‌ها" />
        <div className="mt-10 space-y-3">
          {FAQ_ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <Reveal key={item.q} delay={i * 60}>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition-colors hover:border-white/20">
                  <button
                    type="button"
                    id={`faq-btn-${i}`}
                    aria-expanded={open}
                    aria-controls={`faq-panel-${i}`}
                    onClick={() => setOpenIndex(open ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start text-sm font-bold text-stone-100 sm:px-6 sm:text-base"
                  >
                    {item.q}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('size-5 shrink-0 text-stone-400 transition-transform duration-300', open && 'rotate-180')}
                    />
                  </button>
                  <div
                    id={`faq-panel-${i}`}
                    aria-labelledby={`faq-btn-${i}`}
                    className="lp-acc"
                    data-open={open}
                    role="region"
                  >
                    <div>
                      <p className="border-t border-white/5 px-5 pb-5 pt-4 text-sm leading-7 text-stone-400 sm:px-6">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- final CTA ------------------------------ */

function FinalCta({ onRegister }: { onRegister: () => void }) {
  const openAuthModal = useUiStore((s) => s.openAuthModal);

  return (
    <section className="py-20 lg:py-28" aria-label="شروع استفاده از پُست‌یار">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] border border-primary-400/25 bg-gradient-to-b from-primary-950/60 via-stone-900/90 to-stone-950 px-6 py-16 text-center sm:px-12 lg:py-20">
            <span
              aria-hidden="true"
              className="lp-spin-slow absolute -start-24 -top-24 size-72 rounded-full border border-dashed border-primary-400/20"
            />
            <span
              aria-hidden="true"
              className="lp-spin-slow absolute -bottom-28 -end-20 size-80 rounded-full border border-dashed border-emerald-400/15 [animation-direction:reverse]"
            />
            <span
              aria-hidden="true"
              className="absolute start-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-l from-transparent via-primary-400/60 to-transparent rtl:translate-x-1/2"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-2xl font-bold leading-snug text-stone-50 sm:text-3xl lg:text-4xl">
                همین امروز اولین پست چندکاناله‌تان را منتشر کنید
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-8 text-stone-400 lg:text-base">
                ثبت‌نام کمتر از یک دقیقه طول می‌کشد؛ با پلن رایگان شروع کنید و بدون پرداخت، کانال‌هایتان را متصل
                کنید.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onRegister}
                  className="focus-ring inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-l from-primary-500 to-emerald-500 px-7 text-base font-bold text-stone-950 shadow-[0_12px_40px_-10px_rgba(20,184,166,0.6)] transition-all hover:brightness-110"
                >
                  ساخت حساب رایگان
                  <ArrowLeft aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="focus-ring inline-flex h-12 items-center rounded-2xl border border-white/15 bg-white/5 px-7 text-base font-medium text-stone-200 backdrop-blur transition-colors hover:bg-white/10"
                >
                  ورود به حساب
                </button>
              </div>
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-stone-400">
                {['بدون کارت بانکی', 'فعال‌سازی آنی', 'پشتیبانی فارسی'].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check aria-hidden="true" className="size-4 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------- footer -------------------------------- */

function Footer({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const year = toJalali(new Date()).jy;

  return (
    <footer className="border-t border-white/5 bg-stone-950 pb-8 pt-14">
      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="flex items-center gap-2.5">
              <Logo variant="square" />
              <span className="text-lg font-bold text-stone-50">پُست‌یار</span>
            </span>
            <p className="mt-4 max-w-xs text-xs leading-6 text-stone-400">
              پنل فارسی مدیریت انتشار محتوا در تلگرام، بله و روبیکا — ساخته‌شده برای کسب‌وکارهای ایرانی.
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              {(
                [
                  { label: 'تلگرام', Icon: TelegramIcon },
                  { label: 'بله', Icon: BaleIcon },
                  { label: 'روبیکا', Icon: RubikaIcon },
                ] as const
              ).map(({ label, Icon }) => (
                <a
                  key={label}
                  href="#channels"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToAnchor('channels');
                  }}
                  aria-label={`پشتیبانی در ${label}`}
                  title={label}
                  className="focus-ring rounded-xl border border-white/10 bg-white/5 p-2 transition-colors hover:border-primary-400/40 hover:bg-white/10"
                >
                  <Icon className="size-5" />
                </a>
              ))}
            </div>
          </div>

          <nav aria-label="دسترسی سریع" className="text-sm">
            <p className="mb-4 text-xs font-bold text-stone-500">دسترسی سریع</p>
            <ul className="space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.id}>
                  <a
                    href={`#${link.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToAnchor(link.id);
                    }}
                    className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="امکانات پلتفرم" className="text-sm">
            <p className="mb-4 text-xs font-bold text-stone-500">امکانات</p>
            <ul className="space-y-2.5">
              {[
                'انتشار چندکاناله',
                'زمان‌بندی شمسی',
                'هوش مصنوعی',
                'ربات‌ساز و اتوماسیون',
                'ووکامرس و نرخ طلا',
              ].map((label) => (
                <li key={label}>
                  <a
                    href="#features"
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToAnchor('features');
                    }}
                    className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="text-sm">
            <p className="mb-4 text-xs font-bold text-stone-500">پشتیبانی</p>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="#faq"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToAnchor('faq');
                  }}
                  className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100"
                >
                  سؤالات متداول
                </a>
              </li>
              <li>
                <button type="button" onClick={onLogin} className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100">
                  تیکت پشتیبانی (در پنل)
                </button>
              </li>
              <li>
                <button type="button" onClick={onLogin} className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100">
                  ورود به پنل
                </button>
              </li>
              <li>
                <button type="button" onClick={onRegister} className="focus-ring rounded text-stone-400 transition-colors hover:text-stone-100">
                  ثبت‌نام رایگان
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-stone-500 sm:flex-row">
          <p>© {toFa(year)} پُست‌یار — تمام حقوق محفوظ است.</p>
          <p>ساخته‌شده با علاقه در ایران</p>
        </div>
      </div>
    </footer>
  );
}

/* --------------------------------- page --------------------------------- */

export default function LandingPage() {
  usePageTitle('مدیریت انتشار محتوا در تلگرام، بله و روبیکا');
  const openAuthModal = useUiStore((s) => s.openAuthModal);

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200 antialiased">
      <ScrollProgress />
      <SiteHeader />
      <main id="top">
        <Hero onRegister={() => openAuthModal('register')} />
        <Channels />
        <Features />
        <StatsStrip />
        <HowItWorks />
        <Testimonials />
        <Pricing onRegister={() => openAuthModal('register')} />
        <Faq />
        <FinalCta onRegister={() => openAuthModal('register')} />
      </main>
      <Footer
        onLogin={() => openAuthModal('login')}
        onRegister={() => openAuthModal('register')}
      />
    </div>
  );
}
