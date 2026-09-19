import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageLoading, StatusBadge } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDateTime, faDigits, faRelative, DELIVERY_STATE_FA, PLATFORM_FA, POST_STATE_FA } from '../../lib/format';

const SOURCE_FA: Record<string, string> = {
  MANUAL: 'دستی',
  GOLD: 'طلا',
  WORDPRESS: 'ووکامرس',
  WORKFLOW: 'گردش‌کار',
};

interface PostFullDto {
  id: string;
  title: string | null;
  body: string;
  state: string;
  source: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  mediaId: string | null;
}

interface TargetViewDto {
  id: string;
  channelId: string;
  state: string;
  attempts: number;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  nextRetryAt: string | null;
  platform: string;
  channelTitle: string;
  channelRef: string;
}

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [post, setPost] = useState<PostFullDto | null>(null);
  const [targets, setTargets] = useState<TargetViewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busyTargetId, setBusyTargetId] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.get<{ post: PostFullDto; targets: TargetViewDto[] }>(`/api/v1/posts/${id}`);
      setPost(data.post);
      setTargets(data.targets ?? []);
      setNotFound(false);
      if (data.post?.mediaId) {
        api
          .get<{ url: string }>(`/api/v1/media/${data.post.mediaId}/token`)
          .then((a) => setMediaUrl(a.url))
          .catch(() => setMediaUrl(''));
      } else {
        setMediaUrl('');
      }
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) setNotFound(true);
      else toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const retryTarget = async (targetId: string) => {
    setBusyTargetId(targetId);
    try {
      await api.post(`/api/v1/posts/targets/${targetId}/retry`);
      toast.success('ارسال مجدد در صف قرار گرفت.');
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyTargetId('');
    }
  };

  const cancelPost = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await api.post(`/api/v1/posts/${id}/cancel`);
      toast.success('پست لغو شد.');
      setCancelOpen(false);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <PageLoading />;

  if (notFound || !post) {
    return (
      <EmptyState
        icon="🔍"
        title="پست یافت نشد"
        description="این پست وجود ندارد یا به حساب شما تعلق ندارد."
        action={<Link to="/dashboard/posts" className="btn btn-primary">بازگشت به فهرست پست‌ها</Link>}
      />
    );
  }

  const cancellable = post.state === 'SCHEDULED' || post.state === 'QUEUED';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link to="/dashboard/posts" style={{ fontSize: 12.5 }}>← بازگشت به پست‌ها</Link>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '6px 0 0' }}>{post.title?.trim() || 'پست بدون عنوان'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge state={post.state} labels={POST_STATE_FA} />
          <Badge tone="brand">{SOURCE_FA[post.source] ?? post.source}</Badge>
          {cancellable && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>لغو پست</Button>
          )}
        </div>
      </div>

      <Card pad="lg">
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-2)', marginBottom: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div>تاریخ ایجاد: <strong style={{ color: 'var(--text)' }}>{faDateTime(post.createdAt)}</strong></div>
          {post.scheduledAt && (
            <div>زمان‌بندی انتشار: <strong style={{ color: 'var(--text)' }}>{faDateTime(post.scheduledAt)}</strong></div>
          )}
          {post.publishedAt && (
            <div>زمان انتشار: <strong style={{ color: 'var(--text)' }}>{faDateTime(post.publishedAt)}</strong></div>
          )}
        </div>

        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 2, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {post.body}
        </div>

        {post.mediaId && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 13 }}>
            📎 این پست دارای رسانه پیوست است.
            {mediaUrl && (
              <>
                {' '}
                <a href={mediaUrl} target="_blank" rel="noreferrer">مشاهده رسانه</a>
              </>
            )}
          </div>
        )}
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>
          وضعیت ارسال به کانال‌ها ({faDigits(targets.length)})
        </h3>
        {targets.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: 0 }}>این پست هنوز برای هیچ کانالی ارسال نشده است.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>کانال</th>
                  <th>وضعیت</th>
                  <th>تلاش‌ها</th>
                  <th>زمان ارسال</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.channelTitle}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        {PLATFORM_FA[t.platform] ?? t.platform} — <span dir="ltr">{t.channelRef}</span>
                      </div>
                      {t.errorMessage && (
                        <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>دلیل: {t.errorMessage}</div>
                      )}
                    </td>
                    <td><StatusBadge state={t.state} labels={DELIVERY_STATE_FA} /></td>
                    <td>{faDigits(t.attempts)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.sentAt ? faRelative(t.sentAt) : t.nextRetryAt ? `تلاش بعدی: ${faRelative(t.nextRetryAt)}` : '—'}
                    </td>
                    <td>
                      {t.state === 'FAILED' && (
                        <Button size="sm" variant="soft" loading={busyTargetId === t.id} onClick={() => void retryTarget(t.id)}>
                          تلاش مجدد
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancelPost()}
        busy={cancelling}
        danger
        title="لغو انتشار پست"
        message="آیا از لغو این پست مطمئن هستید؟ ارسال به کانال‌هایی که هنوز ارسال نشده‌اند متوقف می‌شود."
      />
    </div>
  );
}
