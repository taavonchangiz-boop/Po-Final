import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiRequestError, type PlanDto } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatCard, StatusBadge, Textarea } from '../../components/ui';
import { faDate, faDateTime, faDigits, faMoney, faNumber } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';

const ROLE_FA: Record<string, string> = {
  SUPER_ADMIN: 'مدیر ارشد',
  SUPPORT: 'پشتیبانی',
  USER: 'کاربر',
};

const USER_STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  SUSPENDED: 'تعلیق‌شده',
};

const PAYMENT_STATE_FA: Record<string, string> = {
  CREATED: 'ایجادشده',
  REDIRECTED: 'هدایت به درگاه',
  VERIFIED: 'تأییدشده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغوشده',
  REFUNDED: 'بازگشت‌شده',
};

const SETTINGS_KEY_FA: Record<string, string> = {
  referral: 'تنظیمات زیرمجموعه‌گیری',
  gold: 'تنظیمات ربات نرخ طلا',
  ai: 'تنظیمات هوش مصنوعی',
  sms: 'تنظیمات پیامک',
  payment: 'تنظیمات پرداخت',
  security: 'تنظیمات امنیتی',
  plan: 'تنظیمات پلن‌ها',
};

const AUDIT_ACTION_FA: Record<string, string> = {
  'admin.user_suspended': 'تعلیق کاربر',
  'admin.user_activated': 'فعال‌سازی کاربر',
  'admin.grant_subscription': 'هدیهٔ اشتراک',
  'admin.payment_approved': 'تأیید دستی پرداخت',
  'admin.plan_updated': 'ویرایش پلن',
  'admin.settings_updated': 'به‌روزرسانی تنظیمات',
  'admin.broadcast': 'ارسال همگانی',
  'admin.channel_released': 'آزادسازی کانال',
  'bot.connect': 'اتصال ربات',
  'bot.enable': 'فعال‌سازی ربات',
  'bot.disable': 'غیرفعال‌سازی ربات',
  'bot.command.create': 'افزودن دستور ربات',
  'bot.keyword.create': 'افزودن کلیدواژه',
  'bot.ai.update': 'به‌روزرسانی تنظیمات هوش مصنوعی ربات',
  'workflow.create': 'ساخت گردش‌کار',
  'workflow.update': 'ویرایش گردش‌کار',
  'workflow.delete': 'حذف گردش‌کار',
  'channel.connect': 'اتصال کانال',
  'channel.disconnect': 'قطع کانال',
  'post.publish': 'انتشار پست',
  'post.schedule': 'زمان‌بندی پست',
  'wordpress.connected': 'اتصال سایت وردپرس',
  'wordpress.secret_rotated': 'چرخش کلید سایت',
  'auth.login': 'ورود به حساب',
  'auth.register': 'ثبت‌نام',
  'user.register': 'ثبت‌نام کاربر',
  'subscription.activate': 'فعال‌سازی اشتراک',
  'payment.verified': 'تأیید پرداخت',
};

type TabKey = 'overview' | 'users' | 'payments' | 'settings' | 'audit';

interface AdminUserRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  businessName?: string | null;
  role?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

interface AdminPaymentRow {
  id: string;
  purpose?: string | null;
  amountRial?: number;
  state?: string | null;
  tenantId?: string | null;
  userEmail?: string | null;
  createdAt?: string | null;
}

interface AuditRow {
  id: string;
  actorId?: string | null;
  actorRole?: string | null;
  action?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  createdAt?: string | null;
}

interface SettingsMap {
  [key: string]: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export default function Admin() {
  const { me } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>('overview');
  const [plans, setPlans] = useState<PlanDto[]>([]);

  // overview
  const [overview, setOverview] = useState<{ users?: number; activeSubscriptions?: number; paymentsVerifiedSum30d?: number; deliveriesFailed24h?: number; scheduledPosts?: number } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // users
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [usersLoading, setUsersLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState<AdminUserRow | null>(null);
  const [grantPlan, setGrantPlan] = useState('');
  const [grantMonths, setGrantMonths] = useState(1);
  const [grantBusy, setGrantBusy] = useState(false);

  // payments
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);

  // settings
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [newKey, setNewKey] = useState('');

  // audit
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);

  const isAdmin = me?.user.role === 'SUPER_ADMIN' || me?.user.role === 'SUPPORT';

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const d = await api.get<{ users?: number; activeSubscriptions?: number; paymentsVerifiedSum30d?: number; deliveriesFailed24h?: number; scheduledPosts?: number }>('/api/v1/admin/overview');
      setOverview(d);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت آمار مدیریتی ناموفق بود.');
    } finally {
      setOverviewLoading(false);
    }
  }, [toast]);

  const loadUsers = useCallback(async (p: number, term: string) => {
    setUsersLoading(true);
    try {
      const q = term ? `&search=${encodeURIComponent(term)}` : '';
      const d = await api.get<{ items?: AdminUserRow[]; total?: number; page?: number }>(`/api/v1/admin/users?page=${p}${q}`);
      setUsers(d.items ?? []);
      setUsersTotal(Number(d.total ?? 0));
      setUsersPage(Number(d.page ?? p));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت کاربران ناموفق بود.');
    } finally {
      setUsersLoading(false);
    }
  }, [toast]);

  const loadPayments = useCallback(async (p: number, state: string) => {
    setPaymentsLoading(true);
    try {
      const q = state ? `&state=${encodeURIComponent(state)}` : '';
      const d = await api.get<{ items?: AdminPaymentRow[]; total?: number; page?: number }>(`/api/v1/admin/payments?page=${p}${q}`);
      setPayments(d.items ?? []);
      setPaymentsTotal(Number(d.total ?? 0));
      setPaymentsPage(Number(d.page ?? p));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت پرداخت‌ها ناموفق بود.');
    } finally {
      setPaymentsLoading(false);
    }
  }, [toast]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const d = await api.get<SettingsMap>('/api/v1/admin/settings');
      const map = asObject(d);
      setSettings(map);
      setSettingsDraft(Object.keys(map).map((k) => JSON.stringify(asObject(map[k]), null, 2)));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت تنظیمات ناموفق بود.');
    } finally {
      setSettingsLoading(false);
    }
  }, [toast]);

  const loadAudit = useCallback(async (p: number) => {
    setAuditLoading(true);
    try {
      const d = await api.get<{ items?: AuditRow[]; total?: number; page?: number }>(`/api/v1/admin/audit-logs?page=${p}`);
      setAudit(d.items ?? []);
      setAuditTotal(Number(d.total ?? 0));
      setAuditPage(Number(d.page ?? p));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت گزارش رویداد ناموفق بود.');
    } finally {
      setAuditLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isAdmin) return;
    void api
      .get<{ plans?: PlanDto[] }>('/api/v1/subscriptions/plans')
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => undefined);
    void loadOverview();
  }, [isAdmin, loadOverview]);

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'users') void loadUsers(usersPage, search);
    if (tab === 'payments') void loadPayments(paymentsPage, stateFilter);
    if (tab === 'settings' && settings === null) void loadSettings();
    if (tab === 'audit') void loadAudit(auditPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

  if (me && !isAdmin) {
    return (
      <EmptyState
        icon="⛔"
        title="دسترسی مدیریتی ندارید"
        description="این بخش ویژهٔ مدیران سامانه است. اگر فکر می‌کنید اشتباهی رخ داده، با پشتیبانی تماس بگیرید."
      />
    );
  }

  const toggleUser = async (u: AdminUserRow) => {
    const suspended = u.status === 'SUSPENDED';
    setBusyId(u.id);
    try {
      await api.post(`/api/v1/admin/users/${u.id}/${suspended ? 'activate' : 'suspend'}`);
      toast.success(suspended ? 'کاربر فعال شد.' : 'کاربر تعلیق شد.');
      await loadUsers(usersPage, search);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'عملیات ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const submitGrant = async () => {
    if (!grantUser || !grantPlan) {
      toast.error('پلن را انتخاب کنید.');
      return;
    }
    setGrantBusy(true);
    try {
      await api.post(`/api/v1/admin/users/${grantUser.id}/grant-subscription`, { planCode: grantPlan, months: grantMonths });
      toast.success(`اشتراک هدیه برای «${grantUser.firstName ?? ''} ${grantUser.lastName ?? ''}`.trim() + ' ثبت شد.');
      setGrantUser(null);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ثبت هدیه ناموفق بود.');
    } finally {
      setGrantBusy(false);
    }
  };

  const approvePayment = async () => {
    if (!approveId) return;
    setApproveBusy(true);
    try {
      await api.post(`/api/v1/admin/payments/${approveId}/approve`);
      toast.success('پرداخت تأیید و اعمال شد.');
      setApproveId(null);
      await loadPayments(paymentsPage, stateFilter);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'تأیید پرداخت ناموفق بود.');
    } finally {
      setApproveBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    const payload: Record<string, unknown> = {};
    const keys = Object.keys(settings);
    for (let i = 0; i < keys.length; i += 1) {
      try {
        const parsed = JSON.parse(settingsDraft[i] ?? '{}') as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error(`مقدار «${keys[i]}» باید یک شیء JSON معتبر باشد.`);
          return;
        }
        payload[keys[i]] = parsed;
      } catch {
        toast.error(`متن JSON کلید «${keys[i]}» معتبر نیست.`);
        return;
      }
    }
    setSettingsSaving(true);
    try {
      await api.put('/api/v1/admin/settings', payload);
      toast.success('تنظیمات ذخیره شد.');
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ تنظیمات ناموفق بود.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const addSettingKey = () => {
    const key = newKey.trim();
    if (!key || !settings) return;
    if (key in settings) {
      toast.error('این کلید از قبل وجود دارد.');
      return;
    }
    setSettings({ ...settings, [key]: {} });
    setSettingsDraft([...settingsDraft, '{}']);
    setNewKey('');
  };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'نمای کلی' },
    { key: 'users', label: 'کاربران' },
    { key: 'payments', label: 'پرداخت‌ها' },
    { key: 'settings', label: 'تنظیمات' },
    { key: 'audit', label: 'گزارش رویداد' },
  ];

  const approveTarget = payments.find((p) => p.id === approveId);

  const body = ((): ReactNode => {
    if (tab === 'overview') {
      if (overviewLoading) return <PageLoading />;
      return (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          <StatCard icon="👥" bg="var(--brand-soft)" value={faNumber(overview?.users ?? 0)} label="کل کاربران" />
          <StatCard icon="💎" bg="var(--success-soft)" value={faNumber(overview?.activeSubscriptions ?? 0)} label="اشتراک‌های فعال" />
          <StatCard icon="💳" bg="var(--info-soft)" value={faMoney(overview?.paymentsVerifiedSum30d ?? 0)} label="درآمد ۳۰ روز گذشته" />
          <StatCard icon="⚠️" bg="var(--danger-soft)" value={faNumber(overview?.deliveriesFailed24h ?? 0)} label="خطاهای ارسال ۲۴ ساعت" />
          <StatCard icon="⏰" bg="var(--warning-soft)" value={faNumber(overview?.scheduledPosts ?? 0)} label="پست‌های زمان‌بندی‌شده" />
        </div>
      );
    }

    if (tab === 'users') {
      return (
        <Card>
          <form
            style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
              void loadUsers(1, searchInput.trim());
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="جستجو: نام، ایمیل یا کسب‌وکار…" aria-label="جستجوی کاربر" />
            </div>
            <Button type="submit" variant="soft">جستجو</Button>
          </form>

          {usersLoading ? (
            <PageLoading />
          ) : users.length === 0 ? (
            <EmptyState icon="👤" title="کاربری پیدا نشد" description="عبارت جستجو را تغییر دهید." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>نام</th>
                      <th>ایمیل</th>
                      <th>کسب‌وکار</th>
                      <th>نقش</th>
                      <th>وضعیت</th>
                      <th>عضویت</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—'}</td>
                        <td dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{u.email || '—'}</td>
                        <td>{u.businessName || '—'}</td>
                        <td><span className="badge badge-brand">{ROLE_FA[u.role ?? ''] ?? u.role}</span></td>
                        <td><StatusBadge state={u.status ?? ''} labels={USER_STATUS_FA} /></td>
                        <td>{faDate(u.createdAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button size="sm" variant="ghost" loading={busyId === u.id} onClick={() => void toggleUser(u)}>
                              {u.status === 'SUSPENDED' ? 'فعال‌سازی' : 'تعلیق'}
                            </Button>
                            <Button
                              size="sm"
                              variant="soft"
                              onClick={() => {
                                setGrantUser(u);
                                setGrantPlan(plans[0]?.code ?? '');
                                setGrantMonths(1);
                              }}
                            >
                              هدیهٔ اشتراک
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={usersPage} pageSize={20} total={usersTotal} onPage={(p) => void loadUsers(p, search)} />
            </>
          )}
        </Card>
      );
    }

    if (tab === 'payments') {
      return (
        <Card>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 220 }}>
              <Select
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value);
                  void loadPayments(1, e.target.value);
                }}
                aria-label="فیلتر وضعیت پرداخت"
              >
                <option value="">همهٔ وضعیت‌ها</option>
                {Object.entries(PAYMENT_STATE_FA).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </div>
          </div>

          {paymentsLoading ? (
            <PageLoading />
          ) : payments.length === 0 ? (
            <EmptyState icon="💳" title="پرداختی یافت نشد" description="با تغییر فیلتر وضعیت، دوباره جستجو کنید." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>مبلغ</th>
                      <th>وضعیت</th>
                      <th>بابت</th>
                      <th>کاربر</th>
                      <th>زمان</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700 }}>{faMoney(p.amountRial)}</td>
                        <td><StatusBadge state={p.state ?? ''} labels={PAYMENT_STATE_FA} /></td>
                        <td>{p.purpose === 'SUBSCRIPTION' ? 'اشتراک' : p.purpose === 'WALLET_TOPUP' ? 'شارژ کیف پول' : (p.purpose ?? '—')}</td>
                        <td dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{p.userEmail || (p.tenantId ? p.tenantId.slice(0, 10) : '—')}</td>
                        <td>{faDateTime(p.createdAt)}</td>
                        <td>
                          {p.state === 'CREATED' && (
                            <Button size="sm" variant="soft" onClick={() => setApproveId(p.id)}>تأیید دستی</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={paymentsPage} pageSize={20} total={paymentsTotal} onPage={(p) => void loadPayments(p, stateFilter)} />
            </>
          )}
        </Card>
      );
    }

    if (tab === 'settings') {
      if (settingsLoading || settings === null) return <PageLoading />;
      const keys = Object.keys(settings);
      return (
        <div style={{ display: 'grid', gap: 14, maxWidth: 780 }}>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
            مقادیر هر کلید باید یک شیء JSON معتبر باشد. تغییرات پس از ذخیره برای همهٔ کاربران اعمال می‌شود.
          </p>
          {keys.map((key, i) => (
            <Card key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{SETTINGS_KEY_FA[key] ?? `تنظیمات (${key})`}</strong>
                <code dir="ltr" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{key}</code>
              </div>
              <Textarea
                dir="ltr"
                rows={6}
                style={{ fontFamily: 'monospace', fontSize: 12.5, textAlign: 'left' }}
                value={settingsDraft[i] ?? ''}
                onChange={(e) => setSettingsDraft(settingsDraft.map((d, j) => (j === i ? e.target.value : d)))}
                aria-label={`مقدار JSON کلید ${key}`}
              />
            </Card>
          ))}

          <Card>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="کلید جدید">
                  <Input dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="مثلاً referral" />
                </Field>
              </div>
              <Button variant="ghost" onClick={addSettingKey}>افزودن کلید</Button>
            </div>
            <Button onClick={() => void saveSettings()} loading={settingsSaving} disabled={keys.length === 0}>ذخیرهٔ تنظیمات</Button>
          </Card>
        </div>
      );
    }

    // audit
    return (
      <Card>
        {auditLoading ? (
          <PageLoading />
        ) : audit.length === 0 ? (
          <EmptyState icon="📜" title="رویدادی ثبت نشده است" description="به‌محض فعالیت کاربران، گزارش‌ها اینجا نمایش داده می‌شوند." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>رویداد</th>
                    <th>انجام‌دهنده</th>
                    <th>موضوع</th>
                    <th>زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{AUDIT_ACTION_FA[a.action ?? ''] ?? a.action}</td>
                      <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{a.actorId ? a.actorId.slice(0, 10) : 'سیستم'}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {a.subjectType ? `${a.subjectType} ${a.subjectId ? `· ${a.subjectId.slice(0, 10)}` : ''}` : '—'}
                      </td>
                      <td>{faDateTime(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={auditPage} pageSize={20} total={auditTotal} onPage={(p) => void loadAudit(p)} />
          </>
        )}
      </Card>
    );
  })();

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>پنل مدیریت</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          {me?.user.role === 'SUPER_ADMIN' ? 'دسترسی کامل مدیریتی' : 'دسترسی پشتیبانی'} — تعداد کلیدهای تنظیمات: {faDigits(settings ? Object.keys(settings).length : 0)}
        </p>
      </div>

      <div role="tablist" aria-label="بخش‌های پنل مدیریت" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {body}

      <Modal open={Boolean(grantUser)} onClose={() => setGrantUser(null)} title="هدیهٔ اشتراک">
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
          اشتراک هدیه برای «{`${grantUser?.firstName ?? ''} ${grantUser?.lastName ?? ''}`.trim() || 'این کاربر'}» فعال می‌شود.
        </p>
        <Field label="پلن" required>
          <Select value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>
            <option value="">— انتخاب پلن —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.code}>{p.nameFa}</option>
            ))}
          </Select>
        </Field>
        <Field label="مدت (ماه)" required>
          <Select value={String(grantMonths)} onChange={(e) => setGrantMonths(Number(e.target.value))}>
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>{faDigits(m)} ماه</option>
            ))}
          </Select>
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void submitGrant()} loading={grantBusy}>ثبت هدیه</Button>
          <Button variant="ghost" onClick={() => setGrantUser(null)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(approveId)}
        onClose={() => setApproveId(null)}
        onConfirm={() => void approvePayment()}
        title="تأیید دستی پرداخت"
        message={`تأیید پرداخت ${faMoney(approveTarget?.amountRial)} باعث فعال‌سازی اشتراک یا شارژ کیف پول کاربر می‌شود. ادامه می‌دهید؟`}
        danger
        busy={approveBusy}
      />
    </div>
  );
}
