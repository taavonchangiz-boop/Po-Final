import {
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  Coins,
  CreditCard,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  MessagesSquare,
  ScrollText,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of navigation for the app shell (sidebar + mobile navbar).
 * Labels are Persian; icons are Lucide. RTL layout is handled by the shell.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** NavLink `end` — exact match only (needed for the /app index route). */
  end?: boolean;
}

/** Main (user) navigation. */
export const MAIN_NAV: NavItem[] = [
  { to: '/app', label: 'نمای کلی', icon: LayoutDashboard, end: true },
  { to: '/app/channels', label: 'کانال‌ها', icon: MessagesSquare },
  { to: '/app/publishing', label: 'انتشار', icon: Send },
  { to: '/app/scheduling', label: 'زمان‌بندی', icon: CalendarClock },
  { to: '/app/bots', label: 'ربات‌ها', icon: Bot },
  { to: '/app/workflows', label: 'گردش‌کارها', icon: Workflow },
  { to: '/app/ai', label: 'هوش مصنوعی', icon: Sparkles },
  { to: '/app/woocommerce', label: 'ووکامرس', icon: ShoppingBag },
  { to: '/app/gold', label: 'طلا', icon: Coins },
  { to: '/app/analytics', label: 'گزارش‌ها', icon: BarChart3 },
  { to: '/app/subscription', label: 'اشتراک', icon: CreditCard },
  { to: '/app/wallet', label: 'کیف پول', icon: Wallet },
  { to: '/app/referrals', label: 'دعوت دوستان', icon: UserPlus },
  { to: '/app/notifications', label: 'اعلان‌ها', icon: Bell },
  { to: '/app/settings', label: 'تنظیمات', icon: Settings },
  { to: '/app/support', label: 'پشتیبانی', icon: LifeBuoy },
];

/** Admin navigation (rendered only for ADMIN / SUPER_ADMIN). */
export const ADMIN_NAV: NavItem[] = [
  { to: '/app/admin', label: 'داشبورد مدیریت', icon: Shield, end: true },
  { to: '/app/admin/users', label: 'کاربران', icon: Users },
  { to: '/app/admin/tickets', label: 'تیکت‌ها', icon: Ticket },
  { to: '/app/admin/plans', label: 'پلن‌ها', icon: Layers },
  { to: '/app/admin/audit', label: 'رخدادها', icon: ScrollText },
];

function pickMain(to: string): NavItem {
  const item = MAIN_NAV.find((i) => i.to === to);
  if (!item) throw new Error(`nav config: missing item ${to}`);
  return item;
}

/** Mobile bottom-bar primary destinations (user feedback item 7). */
export const MOBILE_PRIMARY_NAV: NavItem[] = [
  pickMain('/app'),
  pickMain('/app/channels'),
  pickMain('/app/publishing'),
  pickMain('/app/bots'),
  pickMain('/app/analytics'),
];

/** Everything else — shown inside the «سایر» glass bottom sheet. */
export const MOBILE_MORE_NAV: NavItem[] = MAIN_NAV.filter(
  (item) => !MOBILE_PRIMARY_NAV.includes(item),
);
