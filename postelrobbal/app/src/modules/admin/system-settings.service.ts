import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import nodemailer from 'nodemailer';

/**
 * System settings for the admin panel v2 — SMS + SMTP email.
 *
 * Storage contract: one system_settings row per key, value_json holds a NATIVE
 * JSON scalar (boolean / string / number) or object (smsConfigs), mirroring how
 * payment-settings.service stores its documents. Reads merge stored values over
 * defaults; writes validate strictly and upsert per key
 * (onDuplicateKeyUpdate on setting_key).
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function upsertSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(systemSettings)
    .values({ settingKey: key, valueJson: value as Record<string, unknown> })
    .onDuplicateKeyUpdate({ set: { valueJson: value as Record<string, unknown> } });
}

// ---------------------------------------------------------------------------
// SMS settings
// ---------------------------------------------------------------------------

export const SMS_PROVIDERS = ['smsir', 'melipayamak', 'kavenegar', 'ghasedak'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

type SmsProviderConfig = Record<string, string>;

/** Default credential fields per provider; otpTemplateId is capped at 20 chars. */
const SMS_CONFIG_DEFAULTS: Record<SmsProvider, SmsProviderConfig> = {
  smsir: { apiKey: '', line: '', otpTemplateId: '' },
  melipayamak: { username: '', password: '', from: '' },
  kavenegar: { apiKey: '', from: '' },
  ghasedak: { apiKey: '', line: '' },
};

const SMS_FIELD_MAX: Record<string, number> = { otpTemplateId: 20 };
const SMS_DEFAULT_FIELD_MAX = 128;

export interface SmsSettings {
  enabled: boolean;
  provider: SmsProvider;
  configs: Record<SmsProvider, SmsProviderConfig>;
}

export interface SmsSettingsPatch {
  enabled?: boolean;
  provider?: SmsProvider;
  configs?: {
    smsir?: { apiKey?: string; line?: string; otpTemplateId?: string };
    melipayamak?: { username?: string; password?: string; from?: string };
    kavenegar?: { apiKey?: string; from?: string };
    ghasedak?: { apiKey?: string; line?: string };
  };
}

function mergeSmsConfigs(stored: unknown): Record<SmsProvider, SmsProviderConfig> {
  const merged: Record<SmsProvider, SmsProviderConfig> = {
    smsir: { ...SMS_CONFIG_DEFAULTS.smsir },
    melipayamak: { ...SMS_CONFIG_DEFAULTS.melipayamak },
    kavenegar: { ...SMS_CONFIG_DEFAULTS.kavenegar },
    ghasedak: { ...SMS_CONFIG_DEFAULTS.ghasedak },
  };
  if (!isRecord(stored)) return merged;
  for (const provider of SMS_PROVIDERS) {
    const raw = stored[provider];
    if (!isRecord(raw)) continue;
    for (const field of Object.keys(SMS_CONFIG_DEFAULTS[provider])) {
      const v = raw[field];
      if (typeof v === 'string') {
        merged[provider][field] = v.slice(0, SMS_FIELD_MAX[field] ?? SMS_DEFAULT_FIELD_MAX);
      }
    }
  }
  return merged;
}

export async function getSmsSettings(): Promise<SmsSettings> {
  const db = getDb();
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, ['smsEnabled', 'smsProvider', 'smsConfigs']));

  let enabled = true;
  let provider: SmsProvider = 'smsir';
  let storedConfigs: unknown;
  for (const row of rows) {
    if (row.settingKey === 'smsEnabled') {
      if (typeof row.valueJson === 'boolean') enabled = row.valueJson;
    } else if (row.settingKey === 'smsProvider') {
      if (typeof row.valueJson === 'string' && (SMS_PROVIDERS as readonly string[]).includes(row.valueJson)) {
        provider = row.valueJson as SmsProvider;
      }
    } else if (row.settingKey === 'smsConfigs') {
      storedConfigs = row.valueJson;
    }
  }
  return { enabled, provider, configs: mergeSmsConfigs(storedConfigs) };
}

/** Strict string-field validation — numbers never coerce to strings. */
function ensureSmsField(provider: SmsProvider, field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» برای «${provider}» باید متن باشد.`));
  }
  const max = SMS_FIELD_MAX[field] ?? SMS_DEFAULT_FIELD_MAX;
  if (value.trim().length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» بیش از حد مجاز است.`));
  }
  return value.trim();
}

export async function putSmsSettings(patch: SmsSettingsPatch): Promise<string[]> {
  const updated: string[] = [];
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «enabled» باید بولی باشد.'));
    }
    await upsertSetting('smsEnabled', patch.enabled);
    updated.push('smsEnabled');
  }
  if (patch.provider !== undefined) {
    if (!(SMS_PROVIDERS as readonly string[]).includes(patch.provider)) {
      throw new AppError(ERR.VALIDATION('سرویس‌دهنده پیامک معتبر نیست.'));
    }
    await upsertSetting('smsProvider', patch.provider);
    updated.push('smsProvider');
  }
  if (patch.configs !== undefined) {
    const db = getDb();
    const [row] = await db
      .select({ valueJson: systemSettings.valueJson })
      .from(systemSettings)
      .where(eq(systemSettings.settingKey, 'smsConfigs'))
      .limit(1);
    const merged = mergeSmsConfigs(row?.valueJson);
    for (const provider of SMS_PROVIDERS) {
      const providerPatch = patch.configs[provider];
      if (!providerPatch) continue;
      for (const [field, value] of Object.entries(providerPatch)) {
        if (value === undefined) continue;
        if (!(field in SMS_CONFIG_DEFAULTS[provider])) {
          throw new AppError(ERR.VALIDATION(`فیلد «${field}» برای «${provider}» معتبر نیست.`));
        }
        merged[provider][field] = ensureSmsField(provider, field, value);
      }
    }
    await upsertSetting('smsConfigs', merged);
    updated.push('smsConfigs');
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Email (SMTP) settings
// ---------------------------------------------------------------------------

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

const EMAIL_DEFAULTS: EmailSettings = {
  enabled: true,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  fromName: 'پُست‌یار',
  fromEmail: '',
};

const EMAIL_KEYS = [
  'emailEnabled',
  'smtpHost',
  'smtpPort',
  'smtpSecure',
  'smtpUser',
  'smtpPass',
  'fromName',
  'fromEmail',
] as const;

export interface EmailSettingsPatch {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromName?: string;
  fromEmail?: string;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const db = getDb();
  const rows = await db
    .select({ settingKey: systemSettings.settingKey, valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, [...EMAIL_KEYS]));

  const settings: EmailSettings = { ...EMAIL_DEFAULTS };
  for (const row of rows) {
    const v: unknown = row.valueJson; // JSON column: native scalar at runtime
    switch (row.settingKey) {
      case 'emailEnabled':
        if (typeof v === 'boolean') settings.enabled = v;
        break;
      case 'smtpHost':
        if (typeof v === 'string') settings.host = v;
        break;
      case 'smtpPort':
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535) settings.port = v;
        break;
      case 'smtpSecure':
        if (typeof v === 'boolean') settings.secure = v;
        break;
      case 'smtpUser':
        if (typeof v === 'string') settings.user = v;
        break;
      case 'smtpPass':
        if (typeof v === 'string') settings.pass = v;
        break;
      case 'fromName':
        if (typeof v === 'string' && v.trim() !== '') settings.fromName = v;
        break;
      case 'fromEmail':
        if (typeof v === 'string') settings.fromEmail = v;
        break;
    }
  }
  return settings;
}

function ensureEmailStr(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید متن باشد.`));
  }
  if (value.trim().length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» بیش از حد مجاز است.`));
  }
  return value.trim();
}

export async function putEmailSettings(patch: EmailSettingsPatch): Promise<string[]> {
  const updated: string[] = [];
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «enabled» باید بولی باشد.'));
    }
    await upsertSetting('emailEnabled', patch.enabled);
    updated.push('emailEnabled');
  }
  if (patch.host !== undefined) {
    await upsertSetting('smtpHost', ensureEmailStr(patch.host, 'host', 190));
    updated.push('smtpHost');
  }
  if (patch.port !== undefined) {
    if (typeof patch.port !== 'number' || !Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
      throw new AppError(ERR.VALIDATION('مقدار «port» باید عددی بین ۱ تا ۶۵۵۳۵ باشد.'));
    }
    await upsertSetting('smtpPort', patch.port);
    updated.push('smtpPort');
  }
  if (patch.secure !== undefined) {
    if (typeof patch.secure !== 'boolean') {
      throw new AppError(ERR.VALIDATION('مقدار «secure» باید بولی باشد.'));
    }
    await upsertSetting('smtpSecure', patch.secure);
    updated.push('smtpSecure');
  }
  if (patch.user !== undefined) {
    await upsertSetting('smtpUser', ensureEmailStr(patch.user, 'user', 190));
    updated.push('smtpUser');
  }
  if (patch.pass !== undefined) {
    await upsertSetting('smtpPass', ensureEmailStr(patch.pass, 'pass', 190));
    updated.push('smtpPass');
  }
  if (patch.fromName !== undefined) {
    await upsertSetting('fromName', ensureEmailStr(patch.fromName, 'fromName', 80));
    updated.push('fromName');
  }
  if (patch.fromEmail !== undefined) {
    const email = ensureEmailStr(patch.fromEmail, 'fromEmail', 190);
    if (email !== '' && !email.includes('@')) {
      throw new AppError(ERR.VALIDATION('ایمیل فرستنده معتبر نیست.'));
    }
    await upsertSetting('fromEmail', email);
    updated.push('fromEmail');
  }
  return updated;
}

/**
 * Sends a test email through the SAVED SMTP settings (nodemailer).
 * Never leaks credentials in errors — only the SMTP response line is surfaced.
 */
export async function sendTestEmail(actorId: string, to: string): Promise<{ ok: true; messageId: string }> {
  const settings = await getEmailSettings();
  if (!settings.host || !settings.user) {
    throw new AppError(ERR.VALIDATION('ابتدا تنظیمات SMTP را کامل و ذخیره کنید.'));
  }
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
  });
  try {
    const info = await transport.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail || settings.user}>`,
      to,
      subject: 'ایمیل آزمایشی پُست‌یار',
      html:
        '<div dir="rtl" style="font-family:Vazirmatn,Tahoma,sans-serif;padding:24px;text-align:right;">' +
        '<h2 style="margin:0 0 12px;">ایمیل آزمایشی پُست‌یار</h2>' +
        '<p style="margin:0;color:#475569;">تنظیمات SMTP با موفقیت اعمال شد؛ اگر این ایمیل را می‌بینید، ارسال ایمیل پُست‌یار کار می‌کند.</p>' +
        '</div>',
    });
    await audit({ action: 'admin.email_test', actorId, meta: { to } });
    return { ok: true, messageId: String(info.messageId ?? '') };
  } catch (err) {
    const detail = String((err as { response?: string }).response ?? (err as Error).message ?? 'SMTP_ERROR').slice(0, 200);
    throw new AppError(ERR.VALIDATION(`ارسال ایمیل آزمایشی ناموفق بود: ${detail}`));
  } finally {
    transport.close();
  }
}
