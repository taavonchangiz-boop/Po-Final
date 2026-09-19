import { inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { newId } from '../../core/ids.js';

/**
 * Admin-togglable payment gateway settings (migration 0003).
 *
 * Storage contract: one system_settings row per key, value_json holds a NATIVE
 * JSON document (boolean / string / array) keyed exactly like the API field
 * names — paymentOnlineEnabled, paymentCardToCardEnabled, paymentProvider,
 * cardToCardCards. The drizzle $type<Record<string, unknown>>() annotation on
 * value_json only models the legacy object-shaped keys; the narrow casts below
 * are deliberate and documented because a real JSON column accepts any JSON
 * value and mysql2 parses it back to its native type.
 */

export interface CardToCardCard {
  id: string;
  bankName: string;
  cardNumber: string;
  holderName: string;
}

export interface PaymentSettingsSnapshot {
  onlineEnabled: boolean;
  cardToCardEnabled: boolean;
  provider: string;
  cards: CardToCardCard[];
}

export const PAYMENT_SETTING_KEYS = [
  'paymentOnlineEnabled',
  'paymentCardToCardEnabled',
  'paymentProvider',
  'cardToCardCards',
] as const;

export type PaymentSettingKey = (typeof PAYMENT_SETTING_KEYS)[number];

const DEFAULTS: PaymentSettingsSnapshot = {
  onlineEnabled: true,
  cardToCardEnabled: true,
  provider: 'zarinpal',
  cards: [],
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accepts native JSON booleans and the {enabled:bool} wrapper (legacy admin page). */
function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (isRecord(value) && typeof value['enabled'] === 'boolean') return value['enabled'];
  return fallback;
}

function coerceProvider(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (isRecord(value) && typeof value['provider'] === 'string' && value['provider'].trim() !== '') {
    return value['provider'].trim();
  }
  return fallback;
}

function coerceCards(value: unknown, fallback: CardToCardCard[]): CardToCardCard[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value['cards'])
      ? (value['cards'] as unknown[])
      : null;
  if (!raw) return fallback;
  const cards: CardToCardCard[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!isRecord(item)) continue;
    const bankName = typeof item['bankName'] === 'string' ? item['bankName'].trim() : '';
    const cardNumber = typeof item['cardNumber'] === 'string' ? item['cardNumber'].trim() : '';
    const holderName = typeof item['holderName'] === 'string' ? item['holderName'].trim() : '';
    if (!bankName || !cardNumber || !holderName) continue;
    cards.push({
      id: typeof item['id'] === 'string' && item['id'].trim() !== '' ? item['id'].trim() : newId(),
      bankName,
      cardNumber,
      holderName,
    });
  }
  return cards;
}

export async function getPaymentSettings(): Promise<PaymentSettingsSnapshot> {
  const db = getDb();
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, [...PAYMENT_SETTING_KEYS]));

  const snapshot: PaymentSettingsSnapshot = { ...DEFAULTS };
  for (const row of rows) {
    switch (row.settingKey) {
      case 'paymentOnlineEnabled':
        snapshot.onlineEnabled = coerceBool(row.valueJson, DEFAULTS.onlineEnabled);
        break;
      case 'paymentCardToCardEnabled':
        snapshot.cardToCardEnabled = coerceBool(row.valueJson, DEFAULTS.cardToCardEnabled);
        break;
      case 'paymentProvider':
        snapshot.provider = coerceProvider(row.valueJson, DEFAULTS.provider);
        break;
      case 'cardToCardCards':
        snapshot.cards = coerceCards(row.valueJson, DEFAULTS.cards);
        break;
    }
  }
  return snapshot;
}

async function upsertSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(systemSettings)
    .values({ settingKey: key, valueJson: value as Record<string, unknown> })
    .onDuplicateKeyUpdate({ set: { valueJson: value as Record<string, unknown> } });
}

export interface PaymentSettingsPatch {
  paymentOnlineEnabled?: boolean;
  paymentCardToCardEnabled?: boolean;
  paymentProvider?: string;
  cardToCardCards?: Array<{ id?: string; bankName: string; cardNumber: string; holderName: string }>;
}

/**
 * Persists only the provided keys. Returns the list of keys actually written.
 * Values are stored as native JSON documents (see module docblock); card ids
 * are generated when the admin payload omits them.
 */
export async function putPaymentSettings(patch: PaymentSettingsPatch): Promise<string[]> {
  const updated: string[] = [];
  if (patch.paymentOnlineEnabled !== undefined) {
    await upsertSetting('paymentOnlineEnabled', patch.paymentOnlineEnabled);
    updated.push('paymentOnlineEnabled');
  }
  if (patch.paymentCardToCardEnabled !== undefined) {
    await upsertSetting('paymentCardToCardEnabled', patch.paymentCardToCardEnabled);
    updated.push('paymentCardToCardEnabled');
  }
  if (patch.paymentProvider !== undefined) {
    await upsertSetting('paymentProvider', patch.paymentProvider);
    updated.push('paymentProvider');
  }
  if (patch.cardToCardCards !== undefined) {
    const cards: CardToCardCard[] = patch.cardToCardCards.map((c) => ({
      id: c.id && c.id.trim() !== '' ? c.id.trim() : newId(),
      bankName: c.bankName.trim(),
      cardNumber: c.cardNumber.trim(),
      holderName: c.holderName.trim(),
    }));
    await upsertSetting('cardToCardCards', cards);
    updated.push('cardToCardCards');
  }
  return updated;
}
