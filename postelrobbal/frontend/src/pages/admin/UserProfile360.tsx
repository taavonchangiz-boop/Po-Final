import { useEffect, useState } from 'react';
import { api, avatarPhotoUrl } from '../../lib/api';
import { Badge, Button, EmptyState, Modal, PageLoading, StatusBadge } from '../../components/ui';
import { Avatar } from '../../components/Avatar';
import { faDate, faDateTime, faDigits, faMoney, faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { ROLE_FA, USER_STATUS_FA, errText, strField, type AdminUserRow } from './shared';

/* ------------------------------------------------------------------ */
/* پروفایل ۳۶۰ درجه — full-circle user profile modal (round 18-c).     */
/* Data: GET /admin/users/:id/profile360 (contract 18-a item 3).       */
/* Quick actions REUSE the host page's existing handlers (onGift /     */
/* onToggleStatus) so suspend & gift stay single-sourced — the modal   */
/* closes when an action dialog opens (asovin triggerGiftFromProfile   */
/* flow) and the host refreshes its own list.                          */
/* ------------------------------------------------------------------ */

interface Profile360User {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mobile?: string | null;
  businessName?: string | null;
  businessType?: string | null;
  role?: string | null;
  status?: string | null;
  createdAt?: string | null;
  lastLoginAt?: string | null;
  avatarKind?: string | null;
  avatarValue?: string | null;
  avatarMediaId?: string | null;
  referralCode?: string | null;
}

interface Profile360Subscription {
  planNameFa?: string | null;
  planCode?: string | null;
  state?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
}

interface Profile360Stats {
  channels?: { total?: number; active?: number };
  bots?: { total?: number; active?: number };
  posts?: { total?: number; published?: number };
  tickets?: { total?: number; open?: number };
  payments?: { verifiedCount?: number; verifiedSumRial?: number };
  walletBalanceRial?: number;
}

interface Profile360Data {
  user: Profile360User;
  subscription: Profile360Subscription | null;
  stats: Profile360Stats;
}

const SUB_STATE_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغوشده',
  SUSPENDED: 'معلق',
};

/** Business/detail cell of the 2-col panel. */
function BizItem({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="adm-p360__biz-item">
      <span className="adm-p360__biz-label">{label}</span>
      <div className="adm-p360__biz-value" dir={ltr ? 'ltr' : undefined} style={ltr ? { textAlign: 'right' } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function UserProfile360({
  user,
  onClose,
  onGift,
  onToggleStatus,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onGift: (u: AdminUserRow) => void;
  onToggleStatus: (u: AdminUserRow) => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<Profile360Data | null>(null);

  const userId = user?.id ?? '';

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    setData(null);
    void api
      .get<Profile360Data>(`/api/v1/admin/users/${userId}/profile360`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => {
        if (!alive) return;
        setFailed(true);
        toast.error(errText(err, 'دریافت پروفایل ۳۶۰° ناموفق بود.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const p = data?.user;
  const stats = data?.stats;
  const sub = data?.subscription ?? null;

  const name = p ? `${strField(p.firstName)} ${strField(p.lastName)}`.trim() : `${strField(user?.firstName)} ${strField(user?.lastName)}`.trim();
  const displayName = name || '—';
  const status = strField(p?.status, strField(user?.status));
  const avatarKind = strField(p?.avatarKind, strField(user?.avatarKind));
  const photoUrl = avatarKind === 'photo' ? avatarPhotoUrl(strField(p?.id, userId), p?.avatarMediaId ?? user?.avatarMediaId) : undefined;

  // Subscription expiry warning: less than 7 days left.
  const expiresSoon = (() => {
    if (!sub?.expiresAt) return false;
    const t = new Date(sub.expiresAt).getTime();
    return Number.isFinite(t) && t - Date.now() < 7 * 24 * 60 * 60 * 1000 && t > Date.now();
  })();

  // Fresh status from the 360 endpoint (falls back to the list row) — the
  // quick-action callbacks receive a complete AdminUserRow.
  const actionRow: AdminUserRow | null = user
    ? { ...user, status, role: strField(p?.role, strField(user.role)) }
    : null;

  const ch = stats?.channels ?? {};
  const bots = stats?.bots ?? {};
  const posts = stats?.posts ?? {};
  const tickets = stats?.tickets ?? {};
  const payments = stats?.payments ?? {};
  const wallet = Number(stats?.walletBalanceRial ?? 0);

  const tiles: Array<{ emoji: string; label: string; value: string; sub?: string }> = [
    { emoji: '📻', label: 'کانال‌ها', value: `${faNumber(Number(ch.active ?? 0))} از ${faNumber(Number(ch.total ?? 0))}`, sub: 'فعال از مجموع' },
    { emoji: '🤖', label: 'ربات‌ها', value: `${faNumber(Number(bots.active ?? 0))} از ${faNumber(Number(bots.total ?? 0))}`, sub: 'فعال از مجموع' },
    { emoji: '📝', label: 'پست‌ها', value: `${faNumber(Number(posts.published ?? 0))} از ${faNumber(Number(posts.total ?? 0))}`, sub: 'منتشرشده از مجموع' },
    { emoji: '🎫', label: 'تیکت‌ها', value: `${faNumber(Number(tickets.open ?? 0))} از ${faNumber(Number(tickets.total ?? 0))}`, sub: 'باز از مجموع' },
    { emoji: '💳', label: 'پرداخت‌های تأییدشده', value: faNumber(Number(payments.verifiedCount ?? 0)), sub: faMoney(Number(payments.verifiedSumRial ?? 0)) },
    { emoji: '👛', label: 'کیف پول', value: faMoney(wallet) },
  ];

  return (
    <Modal open={user !== null} onClose={onClose} title="پروفایل ۳۶۰ درجه" large>
      {loading ? (
        <PageLoading />
      ) : failed || !p ? (
        <EmptyState icon="🔍" title="پروفایل پیدا نشد" description="این کاربر ممکن است حذف شده باشد؛ فهرست کاربران را به‌روزرسانی کنید." />
      ) : (
        <div className="adm-p360">
          {/* header card */}
          <div className="adm-p360__header">
            <Avatar kind={avatarKind} value={strField(p.avatarValue)} photoUrl={photoUrl} name={displayName} size={56} />
            <div className="adm-p360__id">
              <h3>{displayName}</h3>
              <span dir="ltr" style={{ textAlign: 'right' }}>{strField(p.email) || '—'}</span>
              <div className="adm-p360__badges">
                <Badge tone="brand">{ROLE_FA[strField(p.role)] ?? strField(p.role)}</Badge>
                <StatusBadge state={status} labels={USER_STATUS_FA} />
              </div>
            </div>
          </div>

          {/* subscription box */}
          {sub ? (
            <div className={`adm-p360__sub-box${expiresSoon ? ' adm-p360__sub-box--warning' : ''}`}>
              <Badge tone="brand">💎 {strField(sub.planNameFa) || 'پلن فعال'}</Badge>
              <StatusBadge state={strField(sub.state)} labels={SUB_STATE_FA} />
              <span>عضویت از: {faDate(sub.startedAt)}</span>
              <span>اعتبار تا: {faDate(sub.expiresAt)}</span>
              {expiresSoon && <span className="adm-p360__sub-warn">⚠️ کمتر از ۷ روز باقی مانده است</span>}
            </div>
          ) : (
            <div className="adm-p360__sub-box adm-p360__sub-box--muted">
              <span>بدون اشتراک فعال / رایگان</span>
            </div>
          )}

          {/* business + identity panel */}
          <div className="adm-p360__biz">
            <BizItem label="نام کسب‌وکار" value={strField(p.businessName) || '—'} />
            <BizItem label="حوزه فعالیت" value={strField(p.businessType) || '—'} />
            {/* Round 19 fix: mobile is an identifier, not a quantity — digit
                conversion only (faDigits); faNumber grouped it with thousand
                separators (۹٬۱۲۰٬۰۰۰٬۰۰۱). */}
            <BizItem label="موبایل" value={strField(p.mobile) ? faDigits(strField(p.mobile)) : '—'} ltr />
            <BizItem label="کد معرف" value={strField(p.referralCode) || '—'} ltr />
            <BizItem label="آخرین ورود" value={p.lastLoginAt ? faDateTime(p.lastLoginAt) : '—'} />
            <BizItem label="تاریخ عضویت" value={faDate(p.createdAt)} />
          </div>

          {/* stats */}
          <h4 className="adm-subhead">آمار جامع عملکرد ۳۶۰ درجه</h4>
          <div className="adm-p360-grid">
            {tiles.map((t) => (
              <div key={t.label} className="adm-p360__tile">
                <span className="adm-p360__tile-emoji" aria-hidden="true">{t.emoji}</span>
                <span className="adm-p360__tile-label">{t.label}</span>
                <strong>{t.value}</strong>
                {t.sub && <span className="adm-p360__tile-sub">{t.sub}</span>}
              </div>
            ))}
          </div>

          {/* quick actions — reuse host handlers (single-sourced behavior) */}
          <div className="adm-p360__actions">
            <Button
              variant="soft"
              className="adm-p360__gift"
              onClick={() => {
                if (actionRow) onGift(actionRow);
              }}
            >
              🎁 هدیهٔ اشتراک
            </Button>
            <Button variant="ghost" onClick={() => {
              if (actionRow) onToggleStatus(actionRow);
            }}>
              {status === 'SUSPENDED' ? 'فعال‌سازی کاربر' : 'تعلیق کاربر'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              بستن
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
