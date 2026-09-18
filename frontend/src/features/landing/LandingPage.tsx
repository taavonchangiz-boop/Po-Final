import {
  Send,
  CalendarClock,
  Bot,
  Sparkles,
  Coins,
  BarChart3,
  ShoppingBag,
  ArrowDown,
} from 'lucide-react';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { useUiStore } from '../../store/ui';
import { usePageTitle } from '../../app/usePageTitle';

const FEATURES = [
  {
    icon: Send,
    title: 'انتشار هم‌زمان',
    text: 'یک پست بنویسید و هم‌زمان در کانال‌های تلگرام، بله و روبیکا منتشر کنید.',
  },
  {
    icon: CalendarClock,
    title: 'زمان‌بندی جلالی',
    text: 'انتشار خودکار با تقویم شمسی و ساعت ایران؛ بدون فراموشی و بدون تأخیر.',
  },
  {
    icon: Bot,
    title: 'ربات‌های هوشمند',
    text: 'پاسخ‌گویی خودکار به کاربران با دستورها و گردش‌کارهای قابل تعریف.',
  },
  {
    icon: Sparkles,
    title: 'تولید محتوا با هوش مصنوعی',
    text: 'متن پست‌ها را با هوش مصنوعی و قالب‌های فارسی آماده کنید.',
  },
  {
    icon: ShoppingBag,
    title: 'ووکامرس',
    text: 'محصولات فروشگاه شما به‌صورت خودکار و با قیمت به‌روز منتشر می‌شوند.',
  },
  {
    icon: Coins,
    title: 'نرخ لحظه‌ای طلا',
    text: 'قیمت طلا و ارز را با قالب فارسی و ارقام فارسی منتشر کنید.',
  },
];

const STEPS = [
  'یک بار بساز',
  'مقصدها را انتخاب کن',
  'الان یا زمان‌بندی‌شده منتشر کن',
  'همه‌چیز را رصد کن',
];

/** Public marketing page — entry point for login/register via the auth modal. */
export default function LandingPage() {
  usePageTitle('مدیریت انتشار محتوا');
  const openAuthModal = useUiStore((s) => s.openAuthModal);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      {/* Top bar */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 lg:px-8">
          <Logo variant="full" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => openAuthModal('login')}>
              ورود
            </Button>
            <Button size="sm" onClick={() => openAuthModal('register')}>
              شروع رایگان
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-14 text-center lg:px-8 lg:pt-20">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3.5 py-1.5 text-xs font-medium text-primary-800">
            <Sparkles aria-hidden="true" className="size-3.5" />
            پلتفرم فارسی مدیریت انتشار محتوا
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-3xl font-bold leading-[1.5] text-neutral-900 lg:text-5xl lg:leading-[1.5]">
            انتشار در تلگرام، بله و روبیکا
            <span className="text-primary-700"> — همه‌جا با هم</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-neutral-600">
            پُستیار محتوای شما را یک بار می‌گیرد و در همهٔ کانال‌های شما منتشر می‌کند؛ با
            زمان‌بندی شمسی، ربات‌های پاسخ‌گو، هوش مصنوعی و گزارش‌های دقیق.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => openAuthModal('register')}>
              رایگان شروع کنید
            </Button>
            <Button variant="secondary" size="lg" onClick={() => openAuthModal('login')}>
              ورود به حساب
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm text-neutral-500">
            {['تلگرام', 'بله', 'روبیکا'].map((p) => (
              <span
                key={p}
                className="rounded-full border border-neutral-200 bg-white px-4 py-1.5"
              >
                {p}
              </span>
            ))}
          </div>
        </section>

        {/* Flow */}
        <section className="border-y border-neutral-200 bg-white py-10">
          <ol className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-4 px-4">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary-700 text-sm font-bold text-white">
                  {['۱', '۲', '۳', '۴'][i]}
                </span>
                <span className="text-sm font-medium text-neutral-800">{s}</span>
                {i < STEPS.length - 1 && (
                  <ArrowDown aria-hidden="true" className="size-4 rotate-[-90deg] text-neutral-300" />
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 lg:px-8">
          <h2 className="text-center text-2xl font-bold text-neutral-900">
            هر چیزی که برای انتشار حرفه‌ای لازم دارید
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="rounded-card border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <f.icon aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-neutral-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-600">{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Analytics teaser */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 lg:px-8">
          <div className="rounded-card border border-neutral-200 bg-white p-8 text-center shadow-sm">
            <BarChart3 aria-hidden="true" className="mx-auto size-10 text-primary-700" />
            <h2 className="mt-4 text-xl font-bold text-neutral-900">گزارش‌های شفاف، تصمیم‌های دقیق</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-neutral-600">
              نرخ موفقیت ارسال، عملکرد هر کانال، پیام‌های ربات‌ها و مصرف اعتبار هوش مصنوعی را
              با ارقام و تاریخ شمسی ببینید.
            </p>
            <Button className="mt-6" size="lg" onClick={() => openAuthModal('register')}>
              ساخت حساب رایگان
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 text-center text-xs text-neutral-400">
        © پُستیار ۱۴۰۳ — مدیریت انتشار محتوا در تلگرام، بله و روبیکا
      </footer>
    </div>
  );
}
