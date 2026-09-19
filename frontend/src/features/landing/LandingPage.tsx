import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  Check,
  Coins,
  CreditCard,
  Eye,
  Lock,
  MessagesSquare,
  Pencil,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faMoney, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';

/**
 * Public landing page (master prompt §78 section order) — full Persian
 * marketing copy, RTL, sticky header with auth-modal CTA, real pricing preview
 * from the public GET /plans endpoint, FAQ accordion and honest capability
 * notes per provider (Rubika cannot edit sent messages).
 * Reduced motion is respected: the animated logo-webp swaps to a static variant
 * (Logo.tsx) and the global CSS disables animations under the media query.
 */

interface PlanCard {
  id: number | string;
  code?: string;
  name?: string;
  description?: string | null;
  priceMonthly?: number;
  limits?: Record<string, number>;
}

const NAV_LINKS = [
  { href: '#features', label: 'ویژگی‌ها' },
  { href: '#how', label: 'نحوهٔ کار' },
  { href: '#providers', label: 'سرویس‌ها' },
  { href: '#pricing', label: 'تعرفه‌ها' },
  { href: '#faq', label: 'سؤالات متداول' },
] as const;

/* ------------------------------- section shell ------------------------------ */

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  tone = 'light',
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  tone?: 'light' | 'tint';
}) {
  return (
    <section id={id} className={tone === 'tint' ? 'bg-white' : 'bg-neutral-50/60'}>
      <div className="mx-auto w-full max-w-6xl px-4 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && <p className="mb-2 text-xs font-bold tracking-wide text-primary-700">{eyebrow}</p>}
          <h2 className="text-2xl font-bold text-neutral-900 lg:text-3xl">{title}</h2>
          {description && <p className="mt-3 text-sm leading-7 text-neutral-500 lg:text-base">{description}</p>}
        </div>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <Card className="h-full">
      <CardBody>
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
          <Icon aria-hidden="true" className="size-5 text-primary-700" />
        </span>
        <h3 className="mt-4 text-sm font-bold text-neutral-900 lg:text-base">{title}</h3>
        <p className="mt-2 text-xs leading-6 text-neutral-500 lg:text-sm">{text}</p>
      </CardBody>
    </Card>
  );
}

function ProviderSection({
  id,
  name,
  tagline,
  points,
  note,
  accent,
}: {
  id: string;
  name: string;
  tagline: string;
  points: string[];
  note?: string;
  accent: string;
}) {
  return (
    <div id={id} className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:gap-8 lg:p-8">
      <div>
        <span className={'inline-flex rounded-full px-3 py-1 text-xs font-bold ' + accent}>{name}</span>
        <h3 className="mt-3 text-lg font-bold text-neutral-900">{tagline}</h3>
      </div>
      <ul className="space-y-2.5 lg:col-span-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
            <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
            {point}
          </li>
        ))}
        {note && (
          <li className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
            {note}
          </li>
        )}
      </ul>
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function LandingPage() {
  usePageTitle('مدیریت انتشار محتوا در تلگرام، بله و روبیکا');
  const openAuthModal = useUiStore((s) => s.openAuthModal);

  // Public endpoint — real plan cards on the landing page.
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => get<{ items?: PlanCard[] }>('/plans'),
  });

  const FAQS: ReadonlyArray<{ q: string; a: string }> = [
    {
      q: 'پُستیار دقیقاً چه کاری برای من انجام می‌دهد؟',
      a: 'پُستیار یک پنل واحد برای ساخت، زمان‌بندی و انتشار محتوا در تلگرام، بله و روبیکا است. یک بار پست می‌سازید و همان محتوا هم‌زمان در همهٔ کانال‌های انتخابی شما منتشر می‌شود؛ ربات‌ها هم به پیام‌ها پاسخ می‌دهند و نرخ طلا یا محصولات فروشگاه می‌تواند به‌صورت خودکار پست شود.',
    },
    {
      q: 'آیا برای اتصال کانال باید ربات مدیر کانال شود؟',
      a: 'بله. برای انتشار در یک کانال، ربات پُستیار باید در آن کانال مدیر باشد و اجازهٔ ارسال پیام داشته باشد. اطلاعات اتصال به‌صورت رمزنگاری‌شده ذخیره می‌شود و کلیدهای شما هرگز نمایش داده نمی‌شوند.',
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
    {
      q: 'آیا داده‌های من امن است؟',
      a: 'رمزهای عبور به‌صورت هش ذخیره می‌شوند، کلیدها و توکن‌ها رمزنگاری‌شده نگهداری می‌شوند و هر عملیات حساس در گزارش رخدادها ثبت می‌شود. آمارها فقط تعدادی رخداد را می‌شمارند و محتوای خصوصی پیام‌ها هرگز در گزارش‌ها نمایش داده نمی‌شود.',
    },
  ];

  return (
    <div className="min-h-dvh bg-neutral-50">
      {/* ------------------------------- Header ------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 lg:px-8">
          <a href="#top" className="focus-ring rounded-lg" aria-label="پُستیار — صفحهٔ اصلی">
            <Logo variant="full" />
          </a>
          <nav aria-label="فهرست صفحهٔ اصلی" className="mx-auto hidden items-center gap-6 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="focus-ring rounded text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2 lg:ms-0">
            <Button variant="ghost" size="sm" onClick={() => openAuthModal('login')}>
              ورود
            </Button>
            <Button size="sm" onClick={() => openAuthModal('register')}>
              ثبت‌نام رایگان
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* -------------------------------- Hero -------------------------------- */}
        <section className="relative overflow-hidden bg-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 start-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary-100/50 blur-3xl rtl:translate-x-1/2"
          />
          <div className="relative mx-auto w-full max-w-6xl px-4 pb-16 pt-14 text-center lg:px-8 lg:pb-24 lg:pt-20">
            <div className="mb-6 flex justify-center">
              <Logo variant="full" className="h-12 w-auto" />
            </div>
            <h1 className="mx-auto max-w-3xl text-3xl font-black leading-[1.35] text-neutral-900 lg:text-5xl lg:leading-[1.3]">
              یک بار بساز، همه‌جا منتشر کن
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-8 text-neutral-500 lg:text-lg lg:leading-9">
              پُستیار پنل فارسی مدیریت انتشار محتواست: پست‌هایتان را یک‌جا بنویسید و هم‌زمان در تلگرام، بله و
              روبیکا منتشر کنید؛ ربات پاسخ‌گوی مشتریان بسازید، قیمت طلا و محصولات فروشگاه را خودکار پست کنید و
              همه‌چیز را با گزارش‌های شفاف زیر نظر بگیرید.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={() => openAuthModal('register')}>
                شروع رایگان
                <ArrowLeft aria-hidden="true" className="size-4" />
              </Button>
              <a
                href="#pricing"
                className="focus-ring inline-flex h-12 items-center rounded-xl border border-neutral-300 bg-white px-6 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
              >
                مشاهده تعرفه‌ها
              </a>
            </div>
            <p className="mt-4 text-xs text-neutral-400">بدون نیاز به کارت بانکی برای پلن رایگان</p>

            {/* Product preview mockup — pure CSS/table, Persian labels */}
            <div className="mx-auto mt-14 max-w-4xl">
              <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white text-start shadow-xl">
                <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                  <span className="size-3 rounded-full bg-neutral-300" aria-hidden="true" />
                  <span className="size-3 rounded-full bg-neutral-300" aria-hidden="true" />
                  <span className="size-3 rounded-full bg-neutral-300" aria-hidden="true" />
                  <span className="ms-3 rounded-lg bg-white px-3 py-1 text-[11px] text-neutral-400" dir="ltr">
                    postyar.ir/app
                  </span>
                </div>
                <div className="grid gap-0 sm:grid-cols-5">
                  <div className="hidden border-e border-neutral-100 bg-neutral-50/60 p-4 sm:col-span-1 sm:block">
                    <ul className="space-y-2 text-xs text-neutral-500">
                      <li className="rounded-lg bg-primary-100/70 px-2.5 py-1.5 font-bold text-primary-800">نمای کلی</li>
                      <li className="rounded-lg px-2.5 py-1.5">انتشار</li>
                      <li className="rounded-lg px-2.5 py-1.5">زمان‌بندی</li>
                      <li className="rounded-lg px-2.5 py-1.5">ربات‌ها</li>
                      <li className="rounded-lg px-2.5 py-1.5">گزارش‌ها</li>
                    </ul>
                  </div>
                  <div className="p-4 sm:col-span-4">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'ارسال موفق', value: '۱۲٬۴۸۰' },
                        { label: 'نرخ موفقیت', value: '۹۸٫۲٪' },
                        { label: 'کانال فعال', value: '۶' },
                      ].map((kpi) => (
                        <div key={kpi.label} className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3">
                          <p className="text-[10px] text-neutral-400">{kpi.label}</p>
                          <p className="mt-1 text-sm font-bold text-neutral-800">{kpi.value}</p>
                        </div>
                      ))}
                    </div>
                    <table className="mt-4 w-full text-start text-xs">
                      <caption className="sr-only">پیش‌نمایش جدول انتشار پُستیار</caption>
                      <thead>
                        <tr className="text-neutral-400">
                          <th scope="col" className="py-2 text-start font-medium">پست</th>
                          <th scope="col" className="py-2 text-start font-medium">کانال‌ها</th>
                          <th scope="col" className="py-2 text-start font-medium">وضعیت</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 text-neutral-600">
                        <tr>
                          <td className="py-2.5">تخفیف پایان فصل 🎉</td>
                          <td className="py-2.5">تلگرام + بله + روبیکا</td>
                          <td className="py-2.5">
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">منتشر شد</span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5">نرخ طلای امروز</td>
                          <td className="py-2.5">کانال قیمت روز</td>
                          <td className="py-2.5">
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">زمان‌بندی‌شده</span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2.5">محصول جدید فروشگاه</td>
                          <td className="py-2.5">تلگرام</td>
                          <td className="py-2.5">
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600">پیش‌نویس</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------- Pain points ----------------------------- */}
        <Section
          eyebrow="چرا پُستیار؟"
          title="همه‌جا پست گذاشتن یعنی کار دوبرابر"
          description="اگر محتوای شما در چند پیام‌رسان منتشر می‌شود، این مشکلات آشناست:"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: 'کپی‌پیست خسته‌کننده', text: 'همان متن و عکس را باید در هر پیام‌رسان جداگانه ارسال کنید.' },
              { title: 'فراموش‌کردن زمان انتشار', text: 'بدون زمان‌بندی، ساعت مناسب انتشار از دست می‌رود.' },
              { title: 'بی‌پاسخ‌ماندن مشتریان', text: 'پیام‌های ریز و درشت کانال بدون پاسخ می‌مانند.' },
              { title: 'ناآگاهی از عملکرد', text: 'نمی‌دانید کدام پست واقعاً دیده و کدام شکست خورده است.' },
            ].map((pain) => (
              <Card key={pain.title} className="h-full border-amber-200/70 bg-amber-50/40">
                <CardBody>
                  <h3 className="text-sm font-bold text-amber-900">{pain.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-amber-800/80">{pain.text}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </Section>

        {/* ----------------------------- Core features ---------------------------- */}
        <Section
          id="features"
          tone="tint"
          eyebrow="ویژگی‌های اصلی"
          title="هر چیزی که برای انتشار حرفه‌ای لازم دارید"
          description="از ساخت و زمان‌بندی پست تا ربات پاسخ‌گو، فروشگاه‌ساز و گزارش دقیق — همه در یک پنل فارسی."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={Send}
              title="انتشار هم‌زمان چندکاناله"
              text="پست را یک بار بسازید و در همهٔ کانال‌های تلگرام، بله و روبیکا منتشر کنید؛ وضعیت هر کانال جداگانه نمایش داده می‌شود."
            />
            <FeatureCard
              icon={Bell}
              title="زمان‌بندی و تکرار خودکار"
              text="پست‌ها را برای ساعت دلخواه زمان‌بندی کنید یا ارسال روزانه/هفتگی/ماهانه بچینید؛ تلاش مجدد خودکار هم تا ۵ بار انجام می‌شود."
            />
            <FeatureCard
              icon={Bot}
              title="ربات‌های پاسخ‌گو"
              text="ربات بسازید و با دستورها و گردش‌کارهای بصری، پاسخ‌گویی خودکار راه بیندازید — بدون یک خط کدنویسی."
            />
            <FeatureCard
              icon={Sparkles}
              title="دستیار هوش مصنوعی"
              text="تولید محتوا، خلاصه‌سازی و پاسخ‌گویی با اعتبار شفاف ماهانه؛ مصرف روزانه همیشه قابل مشاهده است."
            />
            <FeatureCard
              icon={ShoppingBag}
              title="اتصال فروشگاه ووکامرس"
              text="محصولات فروشگاه شما خودکار همگام می‌شوند و از هر محصول، پست آمادهٔ انتشار با قیمت و لینک ساخته می‌شود."
            />
            <FeatureCard
              icon={BarChart3}
              title="گزارش‌های شفاف"
              text="آمار موفقیت هر کانال و ربات، نمودار روزانهٔ ارسال‌ها و رخدادهای حساب — بدون نمایش محتوای خصوصی پیام‌ها."
            />
          </div>
        </Section>

        {/* ------------------------------ How it works ---------------------------- */}
        <Section
          id="how"
          eyebrow="نحوهٔ کار"
          title="در چهار قدم تا اولین انتشار"
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: 'ثبت‌نام کنید', text: 'با شماره موبایل حساب بسازید؛ پلن رایگان شامل ۲ کانال و ۳۰ پست در ماه است.' },
              { title: 'کانال متصل کنید', text: 'ربات پُستیار را مدیر کانال کنید و کانال را در پنل اضافه و تأیید کنید.' },
              { title: 'محتوا بسازید', text: 'پست بنویسید، زمان‌بندی کنید یا از هوش مصنوعی کمک بگیرید.' },
              { title: 'منتشر و پیگیری کنید', text: 'همه‌جا هم‌زمان منتشر شود؛ نتیجه را در گزارش‌ها ببینید.' },
            ].map((step, index) => (
              <li key={step.title} className="rounded-card border border-neutral-200 bg-white p-5 shadow-sm">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary-700 text-sm font-bold text-white">
                  {toFa(index + 1)}
                </span>
                <h3 className="mt-3 text-sm font-bold text-neutral-900">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-neutral-500">{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ------------------------------- Providers ------------------------------ */}
        <Section
          id="providers"
          tone="tint"
          eyebrow="سرویس‌های پشتیبانی‌شده"
          title="سه پیام‌رسان، یک پنل"
          description="پُستیار از طریق رابط رسمی هر سرویس متصل می‌شود؛ امکانات هر سرویس با صداقت در همین صفحه اعلام شده است."
        >
          <div className="space-y-5">
            <ProviderSection
              id="telegram"
              name="تلگرام"
              tagline="کامل‌ترین پشتیبانی برای کانال‌ها و ربات‌ها"
              accent="bg-sky-100 text-sky-800"
              points={[
                'انتشار پست در کانال و گروه با ربات مدیر',
                'ربات پاسخ‌گو با دستور، دکمه و گردش‌کار',
                'حذف و ویرایش پیام از طریق رابط ربات',
              ]}
            />
            <ProviderSection
              id="bale"
              name="بله"
              tagline="پیام‌رسان بومی، آماده برای کسب‌وکارهای ایرانی"
              accent="bg-emerald-100 text-emerald-800"
              points={[
                'انتشار پست در کانال‌های بله با ربات رسمی',
                'ربات پاسخ‌گو با دستورهای کوتاه و پاسخ خودکار',
                'زمان‌بندی و تکرار ارسال مانند تلگرام',
              ]}
            />
            <ProviderSection
              id="rubika"
              name="روبیکا"
              tagline="انتشار مطمئن در روبیکا"
              accent="bg-rose-100 text-rose-800"
              points={[
                'انتشار پست در کانال‌های روبیکا',
                'زمان‌بندی و گزارش وضعیت هر ارسال',
              ]}
              note="توجه: در روبیکا ویرایش پیام پس از ارسال پشتیبانی نمی‌شود؛ متن نهایی را پیش از انتشار بازبینی کنید."
            />
          </div>
        </Section>

        {/* ------------------------- Bots / AI / WooCommerce ----------------------- */}
        <Section
          tone="light"
          eyebrow="قدرت‌های ویژه"
          title="فراتر از انتشار ساده"
        >
          <div className="space-y-5">
            <div id="bots" className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:p-8">
              <div>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <Bot aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-neutral-900">ربات‌های هوشمند</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-500">اتصال ربات با توکن، تأیید خودکار سلامت و وب‌هوک؛ آمار پیام‌های دریافتی و ارسالی هر ربات در داشبورد.</p>
              </div>
              <ul className="space-y-2.5 lg:col-span-2">
                {[
                  'دستورهای متنی مانند «/start» با پاسخ آماده',
                  'گردش‌کارهای چندمرحله‌ای: ارسال پیام، دکمه، شرط و انتظار',
                  'پاسخ خودکار با هوش مصنوعی با سقف اعتبار قابل تنظیم',
                  'فهرست کاربران ربات با حداقل داده (حریم خصوصی)',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div id="ai" className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:p-8">
              <div>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <Sparkles aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-neutral-900">هوش مصنوعی</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-500">کپی‌رایتینگ تبلیغاتی، خلاصه‌سازی متن‌های بلند و پاسخ‌گویی خودکار — با انتخاب سرویس‌دهنده و مدل.</p>
              </div>
              <ul className="space-y-2.5 lg:col-span-2">
                {[
                  'چهار هدف آماده: تولید محتوا، پاسخ‌گویی، خلاصه‌سازی و سفارشی',
                  'سرویس‌های متعدد با برچسب فارسی و امکان تعیین مدل',
                  'سهمیهٔ ماهانهٔ شفاف + نمایش مصرف روزانه',
                  'خروجی‌ها همیشه در تاریخچه با امکان کپی ذخیره می‌شود',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div id="woocommerce" className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:p-8">
              <div>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <ShoppingBag aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-neutral-900">ووکامرس</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-500">افزونهٔ اختصاصی «پُستیار کانکتور» را روی سایت نصب کنید؛ محصولات با قیمت و موجودی به پنل می‌آیند.</p>
              </div>
              <ul className="space-y-2.5 lg:col-span-2">
                {[
                  'همگام‌سازی محصولات با یک کلیک یا خودکار پس از هر تغییر',
                  'ساخت پست آماده از محصول با قیمت ریالی و لینک صفحه',
                  'کلید اتصال اختصاصی برای هر سایت + امکان چرخش فوری کلید',
                  'امنیت با امضای رمزنگاری‌شده (HMAC) روی هر رخداد',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div id="automation" className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:p-8">
              <div>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <Workflow aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-neutral-900">اتوماسیون انتشار</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-500">زمان‌بندی هوشمند، تکرار دوره‌ای و صف ارسال تضمین‌شده؛ هر ارسال با شناسهٔ یکتا و سابقهٔ کامل تلاش‌ها ثبت می‌شود.</p>
              </div>
              <ul className="space-y-2.5 lg:col-span-2">
                {[
                  'زمان‌بندی دقیق با تقویم شمسی و ساعت تهران',
                  'تکرار روزانه، هفتگی و ماهانه بدون ثبت مجدد',
                  'توقف و ادامهٔ زمان‌بندی‌ها به‌صورت لحظه‌ای',
                  'تلاش مجدد خودکار تا ۵ بار با فاصلهٔ زمانی هوشمند',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div id="gold" className="grid gap-6 rounded-card border border-neutral-200 bg-white p-6 shadow-sm lg:grid-cols-3 lg:p-8">
              <div>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-50">
                  <Coins aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-neutral-900">نرخ طلا و ارز</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-500">نرخ‌های طلای ۱۸ و ۲۴ عیار، سکه، نقره، دلار و یورو را ثبت کنید و پنل، پیام زیبای فارسی با تاریخ شمسی می‌سازد.</p>
              </div>
              <ul className="space-y-2.5 lg:col-span-2">
                {[
                  'ثبت دستی نرخ‌ها یا ارسال خودکار در تناوب ساعتی، روزانه و هفتگی',
                  'قالب پیام قابل ویرایش با متغیرهای {assets_table} و {date}',
                  'جلوگیری از ارسال تکراری وقتی نرخ‌ها تغییر نکرده‌اند',
                  'انتشار فوری دستی هر وقت خواستید',
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-6 text-neutral-600">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-700" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* -------------------------------- Analytics ------------------------------ */}
        <Section
          id="analytics"
          eyebrow="گزارش‌ها"
          title="عملکرد را با داده ببینید، نه حدس"
          description="نمودار روزانهٔ ارسال‌های موفق و ناموفق، مقایسهٔ کانال‌ها و ربات‌ها و مصرف اعتبار هوش مصنوعی — همه با اعداد فارسی و تقویم شمسی."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard icon={BarChart3} title="نمودار روزانه" text="روند موفق و ناموفق ارسال‌ها در بازهٔ ۷ تا ۳۰ روزه." />
            <FeatureCard icon={MessagesSquare} title="عملکرد کانال‌ها" text="کدام کانال بیشترین ارسال موفق را داشته است." />
            <FeatureCard icon={Bot} title="عملکرد ربات‌ها" text="پیام‌های دریافتی و ارسالی هر ربات در بازهٔ انتخابی." />
            <FeatureCard icon={Eye} title="شفافیت کامل" text="محتوای خصوصی پیام‌ها هرگز در گزارش‌ها دیده نمی‌شود." />
          </div>
        </Section>

        {/* -------------------------------- Pricing -------------------------------- */}
        <Section
          id="pricing"
          tone="tint"
          eyebrow="تعرفه‌ها"
          title="پلنی برای هر اندازه کسب‌وکار"
          description="با پلن رایگان شروع کنید و هر وقت بزرگ‌تر شدید ارتقا دهید؛ قیمت‌ها ماهانه و به ریال است."
        >
          {plans.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Card key={i} className="p-6">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-3 h-8 w-32" />
                  <Skeleton className="mt-6 h-10 w-full" />
                </Card>
              ))}
            </div>
          ) : plans.error ? (
            <p className="text-center text-sm text-neutral-500">
              بارگذاری تعرفه‌ها ناموفق بود؛{' '}
              <button type="button" className="focus-ring font-medium text-primary-700 underline" onClick={() => void plans.refetch()}>
                تلاش مجدد
              </button>
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {(plans.data?.items ?? []).map((plan) => (
                  <Card key={String(plan.id)} className="flex h-full flex-col">
                    <CardBody className="flex h-full flex-col">
                      <p className="text-sm font-bold text-neutral-900">{plan.name || plan.code}</p>
                      <p className="mt-2 text-lg font-black text-primary-800">
                        {typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0 ? (
                          <>
                            {faMoney(plan.priceMonthly)}
                            <span className="ms-1 text-[10px] font-normal text-neutral-400">/ماه</span>
                          </>
                        ) : (
                          'رایگان'
                        )}
                      </p>
                      <ul className="mt-3 flex-1 space-y-1.5 text-xs text-neutral-600">
                        <li className="flex items-center justify-between gap-2">
                          <span>کانال</span>
                          <span className="font-bold text-neutral-800">{toFa(plan.limits?.channels ?? 0)}</span>
                        </li>
                        <li className="flex items-center justify-between gap-2">
                          <span>پست در ماه</span>
                          <span className="font-bold text-neutral-800">{toFa(plan.limits?.postsPerMonth ?? 0)}</span>
                        </li>
                        <li className="flex items-center justify-between gap-2">
                          <span>اعتبار هوش مصنوعی</span>
                          <span className="font-bold text-neutral-800">{toFa(plan.limits?.aiCredits ?? 0)}</span>
                        </li>
                        <li className="flex items-center justify-between gap-2">
                          <span>ربات</span>
                          <span className="font-bold text-neutral-800">{toFa(plan.limits?.bots ?? 0)}</span>
                        </li>
                      </ul>
                      <Button
                        className="mt-4 w-full"
                        variant={typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0 ? 'secondary' : 'primary'}
                        onClick={() => openAuthModal('register')}
                      >
                        شروع کنید
                      </Button>
                    </CardBody>
                  </Card>
                ))}
              </div>
              <div className="mt-8 text-center">
                <Button variant="secondary" onClick={() => openAuthModal('login')}>
                  مشاهده کامل پلن‌ها در پنل
                  <ArrowLeft aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </>
          )}
        </Section>

        {/* -------------------------------- Security ------------------------------- */}
        <Section
          id="security"
          eyebrow="امنیت"
          title="دادهٔ شما مال شماست و محفوظ می‌ماند"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={Lock} title="رمزنگاری کلیدها" text="توکن ربات‌ها و کلیدهای اتصال به‌صورت رمزنگاری‌شده ذخیره می‌شوند و هرگز نمایش داده نمی‌شوند." />
            <FeatureCard icon={ShieldCheck} title="نشست‌های امن" text="کوکی نشست HttpOnly + محافظ CSRF روی تمام عملیات‌های حساس پنل." />
            <FeatureCard icon={Eye} title="حسابرسی کامل" text="تغییر نقش کاربر، پرداخت‌ها و اقدامات مدیریتی در گزارش رخدادها با IP ثبت می‌شود." />
          </div>
        </Section>

        {/* ---------------------------------- FAQ ---------------------------------- */}
        <Section
          id="faq"
          tone="tint"
          eyebrow="سؤالات متداول"
          title="پاسخ پرتکرارترین پرسش‌ها"
        >
          <div className="mx-auto max-w-3xl space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-card border border-neutral-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-bold text-neutral-900 marker:hidden [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span aria-hidden="true" className="text-neutral-400 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="border-t border-neutral-100 px-5 py-4 text-sm leading-7 text-neutral-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ------------------------------- Final CTA ------------------------------- */}
        <section className="bg-primary-700">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center lg:px-8">
            <h2 className="text-2xl font-bold text-white lg:text-3xl">همین امروز اولین پست چندکاناله‌تان را بفرستید</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-primary-100">
              ثبت‌نام کمتر از یک دقیقه طول می‌کشد؛ با پلن رایگان شروع کنید و بدون پرداخت، کانال‌هایتان را متصل کنید.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="bg-white text-primary-800 hover:bg-primary-50"
                onClick={() => openAuthModal('register')}
              >
                ساخت حساب رایگان
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="text-white hover:bg-primary-600"
                onClick={() => openAuthModal('login')}
              >
                ورود به حساب
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* --------------------------------- Footer --------------------------------- */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 lg:px-8">
          <div>
            <Logo variant="full" />
            <p className="mt-3 max-w-xs text-xs leading-6 text-neutral-500">
              پُستیار، پنل فارسی مدیریت انتشار محتوا در تلگرام، بله و روبیکا — ساخته‌شده برای کسب‌وکارهای ایرانی.
            </p>
          </div>
          <nav aria-label="پیوندهای سریع" className="text-sm">
            <p className="mb-3 text-xs font-bold text-neutral-400">دسترسی سریع</p>
            <ul className="space-y-2 text-neutral-600">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="focus-ring rounded hover:text-neutral-900 hover:underline">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="text-sm">
            <p className="mb-3 text-xs font-bold text-neutral-400">پشتیبانی</p>
            <ul className="space-y-2 text-neutral-600">
              <li className="flex items-center gap-2">
                <Zap aria-hidden="true" className="size-4 text-neutral-400" />
                پاسخ‌گویی تیکت‌ها در روزهای کاری
              </li>
              <li className="flex items-center gap-2">
                <Pencil aria-hidden="true" className="size-4 text-neutral-400" />
                مستندات و راهنمای افزونهٔ وردپرس
              </li>
              <li className="flex items-center gap-2">
                <CreditCard aria-hidden="true" className="size-4 text-neutral-400" />
                پرداخت امن با درگاه‌های بانکی
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-neutral-100 py-4 text-center text-xs text-neutral-400">
          © پُستیار ۱۴۰۳ — ساخته‌شده با علاقه در ایران
        </div>
      </footer>
    </div>
  );
}
