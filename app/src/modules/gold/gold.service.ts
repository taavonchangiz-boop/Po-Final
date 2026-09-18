/**
 * Gold service (api-contract §Gold): per-tenant price entries, per-channel
 * publishing configs, the message formatting kernel and change detection.
 *
 * Formatting kernel: buildGoldText replaces `{assets_table}` (one line per
 * configured asset with its latest price) and `{date}` (long Persian Jalali
 * date) in the config template; the default template is:
 *   🪙 نرخ طلای امروز
 *   {assets_table}
 *   📅 {date}
 *   ارسال‌شده از پُستیار
 *
 * CHANGE DETECTION POLICY (binding for callers):
 *  - The latest snapshot is compared against config.lastPriceSnapshot.
 *  - IDENTICAL prices: manual publish (publishGoldNow) is still allowed — the
 *    user explicitly asked for a send. The scheduled tick (gold.jobs.ts)
 *    SKIPS the send when nothing changed.
 *  - Manual publishes DO refresh lastSentAt + lastPriceSnapshot, so a schedule
 *    whose message already went out today does not duplicate it later that day.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { AnalyticsService } from '../../core/events.js';
import { notFound, validationError } from '../../core/errors.js';
import { faJalaliDateLong, faNumber } from '../../core/jalali.js';
import { withIdempotency } from '../../core/idempotency.js';
import { db } from '../../db/client.js';
import { channels, goldConfigs, goldPrices } from '../../db/schema.js';
import { enqueue } from '../../queue/queues.js';
import { assertOwnership } from '../../security/tenant.js';

export const GOLD_ASSETS = ['GOLD_18K', 'GOLD_24K', 'COIN_EMAMI', 'COIN_HALF', 'COIN_QUARTER', 'SILVER', 'USD', 'EUR'] as const;
export type GoldAsset = (typeof GOLD_ASSETS)[number];
export type GoldFrequency = typeof goldConfigs.$inferSelect['frequency'];
export type GoldConfigRow = typeof goldConfigs.$inferSelect;
export type GoldPriceRow = typeof goldPrices.$inferSelect;

/** Canonical display order (assets without a recorded price are omitted). */
const GOLD_ASSET_ORDER: readonly GoldAsset[] = GOLD_ASSETS;

/** Persian labels for message rendering (spec — exact wording). */
const ASSET_LABELS: Record<GoldAsset, string> = {
  GOLD_18K: 'طلای ۱۸ عیار',
  GOLD_24K: 'طلای ۲۴ عیار',
  COIN_EMAMI: 'سکه امامی',
  COIN_HALF: 'نیم‌سکه',
  COIN_QUARTER: 'ربع‌سکه',
  SILVER: 'نقره',
  USD: 'دلار',
  EUR: 'یورو',
};

export const DEFAULT_GOLD_TEMPLATE = '🪙 نرخ طلای امروز\n{assets_table}\n📅 {date}\nارسال‌شده از پُستیار';

/* ------------------------------ price queries ----------------------------- */

export interface GoldPricePoint {
  asset: GoldAsset;
  price: number;
  source: GoldPriceRow['source'];
  recordedAt: Date;
}

/**
 * Latest price per asset for a user. Bounded strategy: read the newest 200
 * rows (ix_gold_prices_user_asset index, id-ordered) and dedupe in JS keeping
 * the first occurrence per asset — no GROUP BY over the whole table.
 */
export async function listLatestPrices(userId: number): Promise<GoldPricePoint[]> {
  const rows = await db
    .select()
    .from(goldPrices)
    .where(eq(goldPrices.userId, userId))
    .orderBy(desc(goldPrices.id))
    .limit(200);

  const latest = new Map<GoldAsset, GoldPricePoint>();
  for (const row of rows) {
    if (latest.has(row.asset)) continue;
    latest.set(row.asset, { asset: row.asset, price: row.price, source: row.source, recordedAt: row.recordedAt });
  }

  const ordered: GoldPricePoint[] = [];
  for (const asset of GOLD_ASSET_ORDER) {
    const point = latest.get(asset);
    if (point !== undefined) ordered.push(point);
  }
  return ordered;
}

/** Record a MANUAL price entry (contract POST /gold/prices). */
export async function recordPrice(userId: number, input: { asset: GoldAsset; price: number }): Promise<GoldPriceRow> {
  if (!Number.isInteger(input.price) || input.price <= 0) {
    throw validationError('قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد.');
  }
  const inserted = await db
    .insert(goldPrices)
    .values({ userId, asset: input.asset, price: input.price, source: 'MANUAL' })
    .$returningId();
  const id = inserted[0]?.id !== undefined ? Number(inserted[0].id) : 0;

  const rows = await db.select().from(goldPrices).where(eq(goldPrices.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw notFound();

  AnalyticsService.trackEvent({
    userId,
    type: 'gold.price.recorded',
    subjectType: 'gold_price',
    subjectId: row.id,
    data: { asset: row.asset, price: row.price, source: row.source },
  });
  return row;
}

/* --------------------------------- configs -------------------------------- */

export interface GoldConfigListItem {
  id: number;
  channelId: number;
  channelTitle: string;
  channelProvider: typeof channels.$inferSelect['provider'];
  assets: string[];
  frequency: GoldFrequency;
  timeOfDay: string | null;
  timezone: string;
  template: string | null;
  isEnabled: boolean;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** User's gold configs joined with the channel title/provider. */
export async function listConfigs(userId: number): Promise<GoldConfigListItem[]> {
  const rows = await db
    .select({ config: goldConfigs, channelTitle: channels.title, channelProvider: channels.provider })
    .from(goldConfigs)
    .innerJoin(channels, eq(goldConfigs.channelId, channels.id))
    .where(eq(goldConfigs.userId, userId))
    .orderBy(asc(goldConfigs.id));

  return rows.map(({ config, channelTitle, channelProvider }) => ({
    id: config.id,
    channelId: config.channelId,
    channelTitle,
    channelProvider,
    assets: config.assets,
    frequency: config.frequency,
    timeOfDay: config.timeOfDay,
    timezone: config.timezone,
    template: config.template,
    isEnabled: config.isEnabled,
    lastSentAt: config.lastSentAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }));
}

export interface UpsertGoldConfigInput {
  assets: GoldAsset[];
  frequency: GoldFrequency;
  timeOfDay?: string;
  timezone: string;
  template?: string;
  isEnabled: boolean;
}

/**
 * Upsert the per-channel config (unique userId+channelId). The channel must be
 * owned by the user and ACTIVE. DAILY schedules without timeOfDay fall back to
 * '09:00' in the scheduler (documented in gold.jobs.ts).
 */
export async function upsertConfig(userId: number, channelId: number, input: UpsertGoldConfigInput): Promise<GoldConfigRow> {
  const channelRows = await db
    .select({ id: channels.id, userId: channels.userId, status: channels.status })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  const channel = assertOwnership(channelRows[0], userId);
  if (channel.status !== 'ACTIVE') {
    throw validationError('انتشار خودکار فقط برای کانال‌های فعال قابل تنظیم است.');
  }

  const values = {
    userId,
    channelId,
    assets: input.assets as string[],
    frequency: input.frequency,
    timeOfDay: input.timeOfDay ?? null,
    timezone: input.timezone,
    template: input.template ?? null,
    isEnabled: input.isEnabled,
    updatedAt: new Date(),
  };

  await db
    .insert(goldConfigs)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        assets: values.assets,
        frequency: values.frequency,
        timeOfDay: values.timeOfDay,
        timezone: values.timezone,
        template: values.template,
        isEnabled: values.isEnabled,
        updatedAt: values.updatedAt,
      },
    });

  const fresh = await db
    .select()
    .from(goldConfigs)
    .where(and(eq(goldConfigs.userId, userId), eq(goldConfigs.channelId, channelId)))
    .limit(1);
  const row = fresh[0];
  if (row === undefined) throw notFound();

  AnalyticsService.trackEvent({
    userId,
    type: 'gold.config.upserted',
    subjectType: 'gold_config',
    subjectId: row.id,
    data: { channelId, frequency: row.frequency, isEnabled: row.isEnabled },
  });
  return row;
}

/* ---------------------------- formatting kernel --------------------------- */

/**
 * Build the outgoing gold text. Placeholders:
 *  - `{assets_table}` → one line per configured asset that has a price:
 *      «طلای ۱۸ عیار: ۱٬۲۳۴٬۵۶۷ ریال»
 *  - `{date}` → long Persian Jalali date of `jalaliNow` («۱۵ دی ۱۴۰۳»).
 */
export function buildGoldText(config: Pick<GoldConfigRow, 'template' | 'assets'>, prices: GoldPricePoint[], jalaliNow: Date): string {
  const template = config.template !== null && config.template.trim().length > 0 ? config.template : DEFAULT_GOLD_TEMPLATE;
  const selected = prices.filter((p) => config.assets.includes(p.asset));
  const assetsTable = selected.map((p) => `${ASSET_LABELS[p.asset]}: ${faNumber(p.price)} ریال`).join('\n');
  const date = faJalaliDateLong(jalaliNow);
  return template.replaceAll('{assets_table}', assetsTable).replaceAll('{date}', date);
}

/* ---------------------------- change detection ---------------------------- */

/** Latest prices restricted to the config's assets, as a comparable snapshot. */
export function snapshotForConfig(config: Pick<GoldConfigRow, 'assets'>, prices: GoldPricePoint[]): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const p of prices) {
    if (config.assets.includes(p.asset)) snapshot[p.asset] = p.price;
  }
  return snapshot;
}

/**
 * True when the fresh snapshot differs from config.lastPriceSnapshot.
 * No previous snapshot (never sent) counts as changed; an empty fresh snapshot
 * (no prices recorded at all) is handled by callers — it is never "changed".
 */
export function pricesChangedSince(config: Pick<GoldConfigRow, 'lastPriceSnapshot'>, snapshot: Record<string, number>): boolean {
  const prev = config.lastPriceSnapshot;
  if (prev === null || prev === undefined) return true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(snapshot)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if (prev[key] !== snapshot[key]) return true;
  }
  return false;
}

/* ----------------------------- manual publish ----------------------------- */

function zonedDayKeyLocal(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
}

/**
 * Manual publish-now (contract POST /gold/publish): builds the text from the
 * latest prices and enqueues a notifications channel-send. Idempotent per
 * config + Tehran-day (`gold-manual:{configId}:{yyyy-mm-dd}`) — a second press
 * on the same day replays the stored result. Change detection is intentionally
 * NOT applied here (manual sends always go out); see module docstring.
 */
export async function publishGoldNow(userId: number, channelId: number): Promise<{ sent: boolean; configId: number }> {
  const channelRows = await db
    .select({ id: channels.id, userId: channels.userId, status: channels.status })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  const channel = assertOwnership(channelRows[0], userId);
  if (channel.status !== 'ACTIVE') {
    throw validationError('این کانال فعال نیست. ابتدا کانال را تأیید کنید.');
  }

  const configRows = await db
    .select()
    .from(goldConfigs)
    .where(and(eq(goldConfigs.userId, userId), eq(goldConfigs.channelId, channelId)))
    .limit(1);
  const config = configRows[0];
  if (config === undefined) {
    throw notFound('برای این کانال تنظیمات انتشار نرخ طلا ثبت نشده است.');
  }

  const prices = await listLatestPrices(userId);
  const snapshot = snapshotForConfig(config, prices);
  if (Object.keys(snapshot).length === 0) {
    throw validationError('هنوز قیمتی برای دارایی‌های انتخابی ثبت نشده است.');
  }

  const now = new Date();
  const text = buildGoldText(config, prices, now);

  const result = await withIdempotency<{ sent: boolean; configId: number }>(
    `gold-manual:${config.id}:${zonedDayKeyLocal(now, config.timezone)}`,
    'gold',
    async () => {
      const enqueued = await enqueue('notifications', 'channel-send', { channelId, text });
      if (enqueued) {
        await db
          .update(goldConfigs)
          .set({ lastSentAt: now, lastPriceSnapshot: snapshot, updatedAt: now })
          .where(eq(goldConfigs.id, config.id));
      }
      return { sent: enqueued, configId: config.id };
    },
    86_400,
    userId,
  );

  AnalyticsService.trackEvent({
    userId,
    type: 'gold.publish.manual',
    subjectType: 'gold_config',
    subjectId: config.id,
    data: { channelId, sent: result.value.sent, replayed: result.replayed },
  });
  return result.value;
}

/* ------------------------- timezone wall-clock helpers --------------------- */

/** Fixed fallback: Asia/Tehran offset (+03:30 — no DST since 2022), minutes. */
const FALLBACK_TZ_OFFSET_MINUTES = 210;

/** Offset (minutes) of `timezone` at instant `at`; falls back to Tehran on any error. */
function tzOffsetMinutes(timezone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const part = parts.find((p) => p.type === type);
      return part !== undefined ? Number(part.value) : Number.NaN;
    };
    const year = read('year');
    const month = read('month');
    const day = read('day');
    let hour = read('hour');
    const minute = read('minute');
    const second = read('second');
    if ([year, month, day, hour, minute, second].some((v) => Number.isNaN(v))) return FALLBACK_TZ_OFFSET_MINUTES;
    if (hour === 24) hour = 0; // some ICU builds render midnight as 24
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return FALLBACK_TZ_OFFSET_MINUTES;
  }
}

/** Wall-clock calendar day of `at` in `timezone` as `yyyy-mm-dd`. */
export function zonedDayKey(at: Date, timezone: string): string {
  return zonedDayKeyLocal(at, timezone);
}

/** Wall-clock hour (0-23) of `at` in `timezone`. */
export function zonedHour(at: Date, timezone: string): number {
  try {
    const value = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(at);
    const hour = Number(value);
    return Number.isFinite(hour) ? hour % 24 : 0;
  } catch {
    return 0;
  }
}

/**
 * UTC instant of local `yyyy-mm-dd` at local `HH:mm` in `timezone`
 * (double-pass correction so DST-transition days resolve correctly).
 * Returns an invalid Date for malformed input (callers treat it as not-due).
 */
export function zonedTimeToUtc(day: string, timeOfDay: string, timezone: string): Date {
  const dateParts = day.split('-');
  const timeParts = timeOfDay.split(':');
  const y = Number(dateParts[0]);
  const m = Number(dateParts[1]);
  const d = Number(dateParts[2]);
  const hh = Number(timeParts[0] ?? Number.NaN);
  const mm = Number(timeParts[1] ?? Number.NaN);
  if (![y, m, d, hh, mm].every(Number.isFinite) || dateParts.length !== 3) {
    return new Date(Number.NaN);
  }
  let utcMs = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i += 1) {
    utcMs = Date.UTC(y, m - 1, d, hh, mm) - tzOffsetMinutes(timezone, new Date(utcMs)) * 60_000;
  }
  return new Date(utcMs);
}
