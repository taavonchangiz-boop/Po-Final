import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldQuestion, UserCog } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { patch, ApiError } from '../../lib/api';
import { faDate, faDateTime, labelOf, roleLabels, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { userStatusLabels, userStatusTones } from './adminParts';

/**
 * Admin users — search, role change and suspension. Shapes verified against
 * app/src/modules/admin/admin.routes.ts + admin.service.ts:
 *  - GET /admin/users?page&limit&q → { items: [{ id, firstName, lastName, email,
 *    mobile, businessName, businessType, role, status, referralCode, lastLoginAt,
 *    createdAt }], total, page, limit } — SAFE COLUMNS ONLY (no password exists
 *    on rows; passwordHash is never selected).
 *  - PATCH /admin/users/:id { role?, status? } → { user } — demoting the last
 *    SUPER_ADMIN is rejected server-side with a Persian conflict message.
 *  Every mutation is audited server-side (admin.user.updated).
 */

interface AdminUserRecord {
  id: number | string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  mobile?: string;
  businessName?: string | null;
  businessType?: string | null;
  role?: string;
  status?: string;
  referralCode?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export default function AdminUsersPage() {
  usePageTitle('مدیریت کاربران');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const list = usePaged<AdminUserRecord>({
    queryKey: ['admin', 'users', search],
    buildPath: (page, limit) =>
      `/admin/users?page=${page}&limit=${limit}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
  });

  const [roleTarget, setRoleTarget] = useState<AdminUserRecord | null>(null);
  const [roleValue, setRoleValue] = useState('USER');
  const [statusTarget, setStatusTarget] = useState<AdminUserRecord | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const roleMutation = useMutation({
    mutationFn: (input: { id: number | string; role: string }) =>
      patch<{ user?: AdminUserRecord }>(`/admin/users/${String(input.id)}`, { role: input.role }),
    onSuccess: () => {
      pushToast('success', 'نقش کاربر به‌روزرسانی شد.');
      setRoleTarget(null);
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: number | string; status: string }) =>
      patch<{ user?: AdminUserRecord }>(`/admin/users/${String(input.id)}`, { status: input.status }),
    onSuccess: (data) => {
      pushToast(
        'success',
        data?.user?.status === 'SUSPENDED' ? 'حساب کاربر معلق شد.' : 'حساب کاربر فعال شد.',
      );
      setStatusTarget(null);
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
      setStatusTarget(null);
    },
  });

  return (
    <>
      <PageHeader title="کاربران" description="جست‌وجو، نقش‌ها و وضعیت حساب کاربران" />

      <div className="space-y-4">
        <form
          className="flex max-w-xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            label="جست‌وجو"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="نام، ایمیل یا شماره موبایل"
            className="flex-1"
          />
          <Button type="submit" className="mb-0.5">
            <Search aria-hidden="true" className="size-4" />
            جست‌وجو
          </Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              className="mb-0.5"
              onClick={() => {
                setSearchInput('');
                setSearch('');
              }}
            >
              پاک‌کردن
            </Button>
          )}
        </form>

        {list.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="کاربری یافت نشد"
            description={search ? 'عبارت دیگری را جست‌وجو کنید یا فیلتر را پاک کنید.' : 'هنوز کاربری ثبت‌نام نکرده است.'}
          />
        ) : (
          <>
            <Table caption="فهرست کاربران">
              <THead>
                <TR>
                  <TH>نام</TH>
                  <TH>ایمیل</TH>
                  <TH>موبایل</TH>
                  <TH>نقش</TH>
                  <TH>وضعیت</TH>
                  <TH>ثبت‌نام</TH>
                  <TH>آخرین ورود</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {list.items.map((user) => (
                  <TR key={String(user.id)}>
                    <TD className="font-medium text-neutral-900">
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                      {user.businessName ? (
                        <span className="mt-0.5 block text-xs text-neutral-400">{user.businessName}</span>
                      ) : null}
                    </TD>
                    <TD dir="ltr" className="max-w-48 truncate text-xs text-neutral-500">
                      {user.email || '—'}
                    </TD>
                    <TD dir="ltr" className="text-xs text-neutral-500">
                      {toFa(user.mobile ?? '') || '—'}
                    </TD>
                    <TD>
                      <Badge tone={user.role === 'USER' ? 'neutral' : 'info'}>{labelOf(roleLabels, user.role)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={userStatusTones[user.status ?? ''] ?? 'neutral'}>
                        {labelOf(userStatusLabels, user.status)}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDate(user.createdAt)}</TD>
                    <TD className="text-xs text-neutral-500">
                      {user.lastLoginAt ? faDateTime(user.lastLoginAt) : '—'}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRoleValue(user.role ?? 'USER');
                            setRoleTarget(user);
                          }}
                        >
                          تغییر نقش
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStatusTarget(user)}
                          disabled={statusMutation.isPending}
                        >
                          {user.status === 'SUSPENDED' ? 'فعال‌سازی' : 'تعلیق'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination className="mt-4" page={list.page} totalPages={list.totalPages} onChange={list.setPage} />
          </>
        )}

        <p className="flex items-start gap-2 text-xs leading-6 text-neutral-400">
          <ShieldQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          تغییر نقش و وضعیت هر کاربر در گزارش رخدادهای مدیریتی ثبت می‌شود. رمز عبور کاربران به‌هیچ‌وجه قابل مشاهده یا بازیابی نیست.
        </p>
      </div>

      {/* role dialog */}
      <Dialog
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        title="تغییر نقش کاربر"
        description={
          roleTarget ? `${[roleTarget.firstName, roleTarget.lastName].filter(Boolean).join(' ') || 'کاربر'} (${roleTarget.email ?? roleTarget.mobile ?? '—'})` : undefined
        }
        size="sm"
      >
        <div className="space-y-4">
          <Select label="نقش" value={roleValue} onChange={(e) => setRoleValue(e.target.value)} required>
            <option value="USER">کاربر</option>
            <option value="ADMIN">مدیر</option>
            <option value="SUPER_ADMIN">مدیر ارشد</option>
          </Select>
          <p className="text-xs leading-6 text-neutral-500">
            توجه: حداقل یک مدیر ارشد باید در سیستم باقی بماند؛ حذف آخرین مدیر ارشد توسط سامانه پذیرفته نمی‌شود.
          </p>
          <div className="flex items-center gap-2">
            <Button
              loading={roleMutation.isPending}
              onClick={() => {
                if (roleTarget) roleMutation.mutate({ id: roleTarget.id, role: roleValue });
              }}
            >
              ذخیره
            </Button>
            <Button variant="ghost" onClick={() => setRoleTarget(null)} disabled={roleMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>

      {/* suspend/activate confirm */}
      <ConfirmDialog
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) {
            statusMutation.mutate({
              id: statusTarget.id,
              status: statusTarget.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
            });
          }
        }}
        loading={statusMutation.isPending}
        title={statusTarget?.status === 'SUSPENDED' ? 'فعال‌سازی حساب' : 'تعلیق حساب کاربر'}
        description={
          statusTarget?.status === 'SUSPENDED'
            ? 'با فعال‌سازی، کاربر می‌تواند دوباره وارد حساب خود شود.'
            : 'با تعلیق حساب، ورود کاربر مسدود می‌شود؛ داده‌های او حذف نمی‌شود و می‌توانید بعداً حساب را فعال کنید.'
        }
        confirmLabel={statusTarget?.status === 'SUSPENDED' ? 'بله، فعال کن' : 'بله، معلق کن'}
      />
    </>
  );
}
