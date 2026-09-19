import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiRequestError, type BotDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatCard, StatusBadge, Textarea } from '../../components/ui';
import { PLATFORM_FA, faCompact, faDigits, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

const BOT_STATUS_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

const BOT_MODE_FA: Record<string, string> = { WEBHOOK: 'وبهوک', POLLING: 'بررسی دوره‌ای' };

const RESPONSE_KIND_FA: Record<string, string> = {
  TEXT: 'متن',
  BUTTONS: 'دکمه',
  AI: 'هوش مصنوعی',
  WORKFLOW: 'گردش‌کار',
};

const MATCH_KIND_FA: Record<string, string> = { EXACT: 'دقیق', CONTAINS: 'شامل' };

const CAPABILITY_FA: Record<string, string> = {
  sendText: 'ارسال پیام متنی',
  sendMedia: 'ارسال عکس و ویدیو',
  editMessage: 'ویرایش پیام',
  deleteMessage: 'حذف پیام',
  inlineButtons: 'دکمهٔ شیشه‌ای (اینلاین)',
  replyKeyboard: 'کیبورد پاسخ سریع',
  webhook: 'وبهوک',
  polling: 'بررسی دوره‌ای پیام‌ها',
  botIdentity: 'دریافت هویت ربات',
  htmlParseMode: 'قالب‌بندی پیشرفتهٔ متن',
};

const AI_PROMPT_HINT = 'رفتار دستیار را توصیف کنید؛ مثلاً: «تو مشاور فروش فروشگاه هستی؛ کوتاه، مؤدب و به فارسی پاسخ بده و از اطلاعات محصول کمک بگیر.»';

interface CommandRow {
  id: string;
  command: string;
  descriptionFa?: string | null;
  responseKind?: string | null;
  responsePayload?: unknown;
  isEnabled?: number | boolean | null;
}

interface KeywordRow {
  id: string;
  keyword: string;
  matchKind?: string | null;
  responseKind?: string | null;
  responsePayload?: unknown;
  isEnabled?: number | boolean | null;
}

interface BotUserRow {
  id: string;
  displayName?: string | null;
  username?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

interface PayloadDraft {
  text: string;
  systemPrompt: string;
  buttons: Array<{ label: string; url: string }>;
}

type TabKey = 'commands' | 'keywords' | 'users' | 'stats' | 'ai';

function payloadText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const t = (payload as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

function buildPayload(kind: string, draft: PayloadDraft): Record<string, unknown> | undefined {
  if (kind === 'TEXT') {
    if (!draft.text.trim()) return undefined;
    return { text: draft.text.trim() };
  }
  if (kind === 'BUTTONS') {
    const buttons = draft.buttons
      .filter((b) => b.label.trim())
      .map((b) => (b.url.trim() ? { label: b.label.trim(), url: b.url.trim() } : { label: b.label.trim() }));
    if (!draft.text.trim() && buttons.length === 0) return undefined;
    return { ...(draft.text.trim() ? { text: draft.text.trim() } : {}), ...(buttons.length ? { buttons } : {}) };
  }
  if (kind === 'AI') {
    return draft.systemPrompt.trim() ? { systemPrompt: draft.systemPrompt.trim() } : undefined;
  }
  return undefined;
}

function ResponsePayloadEditor({ kind, draft, setDraft }: { kind: string; draft: PayloadDraft; setDraft: (d: PayloadDraft) => void }) {
  if (kind === 'TEXT' || kind === 'BUTTONS') {
    return (
      <>
        <Field label={kind === 'BUTTONS' ? 'متن همراه دکمه‌ها' : 'متن پاسخ'} required={kind === 'TEXT'}>
          <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="متن پاسخ ربات…" />
        </Field>
        {kind === 'BUTTONS' && (
          <Field label="دکمه‌ها" hint="می‌توانید برای هر دکمه نشانی لینک (اختیاری) وارد کنید. حداکثر ۸ دکمه.">
            <div style={{ display: 'grid', gap: 8 }}>
              {draft.buttons.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <Input value={b.label} onChange={(e) => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="عنوان دکمه" />
                  <Input dir="ltr" value={b.url} onChange={(e) => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" style={{ maxWidth: 180 }} />
                  <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, buttons: draft.buttons.filter((_, j) => j !== i) })} aria-label="حذف دکمه">✕</Button>
                </div>
              ))}
              {draft.buttons.length < 8 && (
                <Button variant="soft" size="sm" onClick={() => setDraft({ ...draft, buttons: [...draft.buttons, { label: '', url: '' }] })}>+ افزودن دکمه</Button>
              )}
            </div>
          </Field>
        )}
      </>
    );
  }
  if (kind === 'AI') {
    return (
      <>
        <Field label="راهنمای دستیار (اختیاری)" hint="اگر خالی بماند، راهنمای تنظیم‌شده در بخش «تنظیمات هوش مصنوعی» ربات استفاده می‌شود.">
          <Textarea value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} placeholder={AI_PROMPT_HINT} />
        </Field>
      </>
    );
  }
  return (
    <Field label="گردش‌کار">
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-2)' }}>
        پاسخ این دستور توسط گردش‌کارهای بخش «گردش‌کارها» ساخته می‌شود؛ برای اتصال، از صفحهٔ گردش‌کارها یک گردش‌کار با محرک «دریافت پیام» تعریف کنید.
      </div>
    </Field>
  );
}

export default function BotDetail() {
  const params = useParams<{ id: string }>();
  const botId = params.id ?? '';
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [bot, setBot] = useState<BotDto | null>(null);
  const [tab, setTab] = useState<TabKey>('commands');
  const [capabilities, setCapabilities] = useState<Record<string, boolean> | null>(null);

  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [users, setUsers] = useState<BotUserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [stats, setStats] = useState<{ eventsByKind?: Array<{ kind: string; count: number }>; messagesSent30d?: number; userCount?: number } | null>(null);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSaving, setAiSaving] = useState(false);

  // add-command modal
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdName, setCmdName] = useState('');
  const [cmdDesc, setCmdDesc] = useState('');
  const [cmdKind, setCmdKind] = useState('TEXT');
  const [cmdDraft, setCmdDraft] = useState<PayloadDraft>({ text: '', systemPrompt: '', buttons: [{ label: '', url: '' }] });
  const [cmdSaving, setCmdSaving] = useState(false);

  // add-keyword modal
  const [kwOpen, setKwOpen] = useState(false);
  const [kwText, setKwText] = useState('');
  const [kwMatch, setKwMatch] = useState('CONTAINS');
  const [kwKind, setKwKind] = useState('TEXT');
  const [kwDraft, setKwDraft] = useState<PayloadDraft>({ text: '', systemPrompt: '', buttons: [{ label: '', url: '' }] });
  const [kwSaving, setKwSaving] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    const d = await api.get<{ items?: BotDto[]; bots?: BotDto[] }>('/api/v1/bots');
    const list = d.items ?? d.bots ?? [];
    const found = list.find((b) => b.id === botId) ?? null;
    setBot(found);
    if (found) {
      setAiEnabled(Boolean(found.aiEnabled));
      const detail = found as BotDto & { aiSystemPrompt?: string | null };
      setAiPrompt(typeof detail.aiSystemPrompt === 'string' ? detail.aiSystemPrompt : '');
    }
    return found;
  }, [botId]);

  const loadCommands = useCallback(async () => {
    const d = await api.get<{ items?: CommandRow[] }>(`/api/v1/bots/${botId}/commands`);
    setCommands(d.items ?? []);
  }, [botId]);

  const loadKeywords = useCallback(async () => {
    const d = await api.get<{ items?: KeywordRow[] }>(`/api/v1/bots/${botId}/keywords`);
    setKeywords(d.items ?? []);
  }, [botId]);

  const loadUsers = useCallback(async (page: number) => {
    const d = await api.get<{ items?: BotUserRow[]; total?: number }>(`/api/v1/bots/${botId}/users?page=${page}`);
    setUsers(d.items ?? []);
    setUsersTotal(Number(d.total ?? 0));
    setUsersPage(page);
  }, [botId]);

  const loadStats = useCallback(async () => {
    const d = await api.get<{ eventsByKind?: Array<{ kind: string; count: number }>; messagesSent30d?: number; userCount?: number }>(`/api/v1/bots/${botId}/stats`);
    setStats(d);
  }, [botId]);

  useEffect(() => {
    if (!botId) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const found = await loadBots();
        if (!alive) return;
        if (found) {
          await Promise.all([
            loadCommands().catch(() => undefined),
            loadKeywords().catch(() => undefined),
            loadUsers(1).catch(() => undefined),
            loadStats().catch(() => undefined),
            api
              .get<{ capabilities?: Record<string, boolean> }>(`/api/v1/bots/${botId}/capabilities`)
              .then((d) => {
                if (alive) setCapabilities(d.capabilities ?? null);
              })
              .catch(() => undefined),
          ]);
        }
      } catch {
        // bot stays null → not-found state
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [botId, loadBots, loadCommands, loadKeywords, loadUsers, loadStats]);

  const submitCommand = async () => {
    const name = cmdName.trim();
    if (!name.startsWith('/')) {
      toast.error('دستور باید با «/» شروع شود؛ مثلاً /start');
      return;
    }
    setCmdSaving(true);
    try {
      await api.post(`/api/v1/bots/${botId}/commands`, {
        command: name,
        ...(cmdDesc.trim() ? { descriptionFa: cmdDesc.trim() } : {}),
        responseKind: cmdKind,
        responsePayload: buildPayload(cmdKind, cmdDraft) ?? null,
      });
      toast.success('دستور ذخیره شد.');
      setCmdOpen(false);
      setCmdName('');
      setCmdDesc('');
      setCmdKind('TEXT');
      setCmdDraft({ text: '', systemPrompt: '', buttons: [{ label: '', url: '' }] });
      await loadCommands();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ دستور ناموفق بود.');
    } finally {
      setCmdSaving(false);
    }
  };

  const submitKeyword = async () => {
    if (kwText.trim().length < 2) {
      toast.error('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.');
      return;
    }
    setKwSaving(true);
    try {
      await api.post(`/api/v1/bots/${botId}/keywords`, {
        keyword: kwText.trim(),
        matchKind: kwMatch,
        responseKind: kwKind,
        responsePayload: buildPayload(kwKind, kwDraft) ?? null,
      });
      toast.success('کلیدواژه ذخیره شد.');
      setKwOpen(false);
      setKwText('');
      setKwMatch('CONTAINS');
      setKwKind('TEXT');
      setKwDraft({ text: '', systemPrompt: '', buttons: [{ label: '', url: '' }] });
      await loadKeywords();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ کلیدواژه ناموفق بود.');
    } finally {
      setKwSaving(false);
    }
  };

  const deleteRow = async (id: string, kind: 'command' | 'keyword') => {
    setBusyId(id);
    try {
      if (kind === 'command') {
        await api.del(`/api/v1/bots/commands/${id}`);
        await loadCommands();
      } else {
        await api.del(`/api/v1/bots/keywords/${id}`);
        await loadKeywords();
      }
      toast.success('حذف شد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'حذف ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const saveAi = async () => {
    setAiSaving(true);
    try {
      await api.put(`/api/v1/bots/${botId}/ai`, {
        aiEnabled,
        aiSystemPrompt: aiPrompt.trim() ? aiPrompt.trim() : null,
      });
      toast.success('تنظیمات هوش مصنوعی ذخیره شد.');
      await loadBots();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ تنظیمات ناموفق بود.');
    } finally {
      setAiSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  if (!bot) {
    return (
      <EmptyState
        icon="🤖"
        title="ربات پیدا نشد"
        description="این ربات وجود ندارد یا به حساب شما تعلق ندارد."
        action={<Link to="/dashboard/bots" className="btn btn-primary">بازگشت به فهرست ربات‌ها</Link>}
      />
    );
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'commands', label: 'دستورها' },
    { key: 'keywords', label: 'پاسخگوی کلیدواژه' },
    { key: 'users', label: 'کاربران ربات' },
    { key: 'stats', label: 'آمار' },
    { key: 'ai', label: 'تنظیمات هوش مصنوعی' },
  ];

  const received = stats?.eventsByKind?.find((e) => e.kind === 'message')?.count ?? 0;
  const clicks = stats?.eventsByKind?.find((e) => e.kind === 'callback')?.count ?? 0;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/dashboard/bots" style={{ fontSize: 13 }}>← بازگشت به ربات‌ها</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>{bot.title || 'ربات'}</h1>
          <StatusBadge state={bot.status} labels={BOT_STATUS_FA} />
          <span className="badge badge-brand">{BOT_MODE_FA[bot.mode] ?? bot.mode}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {PLATFORM_FA[bot.platform] ?? bot.platform}
            {bot.username ? ` · @${bot.username}` : ''}
          </span>
        </div>
      </div>

      {capabilities && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>توانایی‌های این پلتفرم</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
            {Object.entries(CAPABILITY_FA).map(([key, label]) => {
              const on = capabilities[key] === true;
              return (
                <span key={key} style={{ color: on ? 'var(--success)' : 'var(--text-2)' }}>
                  <span aria-hidden="true">{on ? '✔' : '✖'}</span> {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div role="tablist" aria-label="بخش‌های ربات" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
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

      {tab === 'commands' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>دستورهای ربات</h2>
            <Button size="sm" onClick={() => setCmdOpen(true)}>+ دستور جدید</Button>
          </div>
          {commands.length === 0 ? (
            <EmptyState icon="⌨️" title="دستوری تعریف نشده است" description="با دستورهایی مثل /start به پیام‌های کاربر پاسخ خودکار بدهید." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>دستور</th>
                    <th>توضیح</th>
                    <th>نوع پاسخ</th>
                    <th>پیش‌نمایش</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{c.command}</td>
                      <td>{c.descriptionFa || '—'}</td>
                      <td><span className="badge badge-brand">{RESPONSE_KIND_FA[c.responseKind ?? 'TEXT'] ?? c.responseKind}</span></td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payloadText(c.responsePayload) || '—'}</td>
                      <td>
                        <Button size="sm" variant="danger" loading={busyId === c.id} onClick={() => void deleteRow(c.id, 'command')}>حذف</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'keywords' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>پاسخگوی کلیدواژه</h2>
            <Button size="sm" onClick={() => setKwOpen(true)}>+ کلیدواژهٔ جدید</Button>
          </div>
          {keywords.length === 0 ? (
            <EmptyState icon="💬" title="کلیدواژه‌ای تعریف نشده است" description="هر وقت کاربر یکی از این کلیدواژه‌ها را بفرستد، ربات پاسخ می‌دهد." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>کلیدواژه</th>
                    <th>نوع تطبیق</th>
                    <th>نوع پاسخ</th>
                    <th>پیش‌نمایش</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => (
                    <tr key={k.id}>
                      <td style={{ fontWeight: 700 }}>{k.keyword}</td>
                      <td><span className="badge badge-info">{MATCH_KIND_FA[k.matchKind ?? 'CONTAINS'] ?? k.matchKind}</span></td>
                      <td><span className="badge badge-brand">{RESPONSE_KIND_FA[k.responseKind ?? 'TEXT'] ?? k.responseKind}</span></td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payloadText(k.responsePayload) || '—'}</td>
                      <td>
                        <Button size="sm" variant="danger" loading={busyId === k.id} onClick={() => void deleteRow(k.id, 'keyword')}>حذف</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'users' && (
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>کاربران ربات</h2>
          {users.length === 0 ? (
            <EmptyState icon="👥" title="هنوز کاری با ربات نکرده‌اند" description="به‌محض اولین پیام کاربران به ربات، اینجا فهرست می‌شوند." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>نام نمایشی</th>
                      <th>نام کاربری</th>
                      <th>اولین بازدید</th>
                      <th>آخرین بازدید</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.displayName || '—'}</td>
                        <td dir="ltr" style={{ textAlign: 'right' }}>{u.username ? `@${u.username}` : '—'}</td>
                        <td>{faRelative(u.firstSeenAt)}</td>
                        <td>{faRelative(u.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={usersPage} pageSize={20} total={usersTotal} onPage={(p) => void loadUsers(p)} />
            </>
          )}
        </Card>
      )}

      {tab === 'stats' && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>آمار ۳۰ روز گذشته</h2>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: 16 }}>
            <StatCard icon="📥" bg="var(--info-soft)" value={faCompact(received)} label="پیام دریافتی" />
            <StatCard icon="📤" bg="var(--success-soft)" value={faCompact(stats?.messagesSent30d ?? 0)} label="پیام ارسالی" />
            <StatCard icon="🖱️" bg="var(--brand-soft)" value={faCompact(clicks)} label="کلیک دکمه" />
            <StatCard icon="👥" bg="var(--warning-soft)" value={faCompact(stats?.userCount ?? 0)} label="کاربران ربات" />
          </div>
          {stats?.eventsByKind && stats.eventsByKind.length > 0 && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>تفکیک رویدادهای ربات</div>
              <ul style={{ listStyle: 'none', display: 'grid', gap: 6, fontSize: 13.5 }}>
                {stats.eventsByKind.map((e) => (
                  <li key={e.kind} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--border)', paddingBottom: 4 }}>
                    <span>{e.kind === 'message' ? 'پیام' : e.kind === 'update' ? 'به‌روزرسانی' : e.kind === 'callback' ? 'کلیک دکمه' : e.kind}</span>
                    <span style={{ fontWeight: 700 }}>{faDigits(e.count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'ai' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>تنظیمات هوش مصنوعی</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            با فعال‌کردن این گزینه، پیام‌هایی که با دستور یا کلیدواژه جواب نمی‌گیرند به‌وسیلهٔ هوش مصنوعی پاسخ داده می‌شوند.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>پاسخگویی خودکار با هوش مصنوعی</span>
          </label>
          <Field label="راهنمای رفتار دستیار" hint={AI_PROMPT_HINT}>
            <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={6} placeholder="مثلاً: تو پشتیبان فروشگاه هستی؛ کوتاه و مؤدب پاسخ بده." />
          </Field>
          <Button onClick={() => void saveAi()} loading={aiSaving}>ذخیرهٔ تنظیمات</Button>
        </div>
      )}

      <Modal open={cmdOpen} onClose={() => setCmdOpen(false)} title="دستور جدید" large>
        <Field label="نام دستور" required hint="با «/» شروع می‌شود؛ فقط حروف انگلیسی، عدد و زیرخط.">
          <Input dir="ltr" value={cmdName} onChange={(e) => setCmdName(e.target.value)} placeholder="/start" />
        </Field>
        <Field label="توضیح (فارسی)">
          <Input value={cmdDesc} onChange={(e) => setCmdDesc(e.target.value)} placeholder="مثلاً: شروع گفتگو و نمایش منو" />
        </Field>
        <Field label="نوع پاسخ" required>
          <Select value={cmdKind} onChange={(e) => setCmdKind(e.target.value)}>
            <option value="TEXT">متن</option>
            <option value="BUTTONS">دکمه</option>
            <option value="AI">هوش مصنوعی</option>
            <option value="WORKFLOW">گردش‌کار</option>
          </Select>
        </Field>
        <ResponsePayloadEditor kind={cmdKind} draft={cmdDraft} setDraft={setCmdDraft} />
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button onClick={() => void submitCommand()} loading={cmdSaving}>ذخیرهٔ دستور</Button>
          <Button variant="ghost" onClick={() => setCmdOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <Modal open={kwOpen} onClose={() => setKwOpen(false)} title="کلیدواژهٔ جدید" large>
        <Field label="کلیدواژه" required hint="کلمه یا عبارتی که اگر کاربر بفرستد، ربات پاسخ می‌دهد.">
          <Input value={kwText} onChange={(e) => setKwText(e.target.value)} placeholder="مثلاً قیمت" />
        </Field>
        <Field label="نوع تطبیق" required>
          <Select value={kwMatch} onChange={(e) => setKwMatch(e.target.value)}>
            <option value="CONTAINS">شامل — هر پیامی که این عبارت را داشته باشد</option>
            <option value="EXACT">دقیق — فقط پیام کاملاً برابر این عبارت</option>
          </Select>
        </Field>
        <Field label="نوع پاسخ" required>
          <Select value={kwKind} onChange={(e) => setKwKind(e.target.value)}>
            <option value="TEXT">متن</option>
            <option value="BUTTONS">دکمه</option>
            <option value="AI">هوش مصنوعی</option>
            <option value="WORKFLOW">گردش‌کار</option>
          </Select>
        </Field>
        <ResponsePayloadEditor kind={kwKind} draft={kwDraft} setDraft={setKwDraft} />
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button onClick={() => void submitKeyword()} loading={kwSaving}>ذخیرهٔ کلیدواژه</Button>
          <Button variant="ghost" onClick={() => setKwOpen(false)}>انصراف</Button>
        </div>
      </Modal>
    </div>
  );
}
