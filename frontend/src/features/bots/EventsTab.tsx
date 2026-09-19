import { MessagesSquare } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { faDateTime, labelOf } from '../../lib/format';
import { usePaged } from '../hooks/usePaged';
import { ErrorCard } from './botUi';
import { errorMessage, eventTypeLabels, type BotEventRecord } from './botTypes';

/**
 * Events tab (task 4-d-1): GET /bots/:id/events (paginated).
 * Rows (bots.service.ts): { id, type, chatId, senderRef, payload, processedAt, createdAt }.
 * Event types written by bot.engine.ts: message | callback_query | member_joined.
 */

export interface EventsTabProps {
  botId: string;
}

export function EventsTab({ botId }: EventsTabProps) {
  const events = usePaged<BotEventRecord>({
    queryKey: ['bot-events', botId],
    buildPath: (page, limit) => `/bots/${botId}/events?page=${page}&limit=${limit}`,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>رویدادهای اخیر</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {events.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : events.error ? (
          <ErrorCard message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        ) : events.items.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="رویدادی ثبت نشده"
            description="پس از دریافت اولین پیام یا کلیک روی دکمه‌های ربات، رویدادها در همین بخش نمایش داده می‌شوند."
          />
        ) : (
          <>
            <Table caption="رویدادهای ربات">
              <THead>
                <TR>
                  <TH>نوع</TH>
                  <TH>چت</TH>
                  <TH>زمان</TH>
                </TR>
              </THead>
              <TBody>
                {events.items.map((ev) => (
                  <TR key={String(ev.id)}>
                    <TD>
                      <Badge tone="info">{labelOf(eventTypeLabels, ev.type)}</Badge>
                    </TD>
                    <TD dir="ltr" className="text-xs text-neutral-500">
                      {ev.chatId || '—'}
                    </TD>
                    <TD className="text-xs text-neutral-500">
                      {faDateTime(ev.createdAt) || '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={events.page}
              totalPages={events.totalPages}
              onChange={events.setPage}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
