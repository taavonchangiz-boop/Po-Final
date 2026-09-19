import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { AI_PROVIDER_IDS } from '../../providers/ai/ai-providers.js';
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

// ---------------------------------------------------------------------------
// Round 17 — dedicated form-shaped settings: general / ai / referral / security
//
// One system_settings key per namespace; value_json holds the whole document.
// Reads merge stored values over defaults (type-checked per field, so a
// hand-edited row can never crash the API); writes validate strictly with
// Persian messages and upsert per key. The 'ai' document field name is
// load-bearing: ai.service.resolveProvider() reads valueJson['default_provider'].
// ---------------------------------------------------------------------------

async function readSettingDoc(key: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, key))
    .limit(1);
  return isRecord(row?.valueJson) ? row.valueJson : {};
}

/** Strict string-field validation — numbers never coerce to strings. */
function ensureDocStr(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید متن باشد.`));
  }
  const v = value.trim();
  if (v.length > max) {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید حداکثر ${max} کاراکتر باشد.`));
  }
  return v;
}

function ensureDocBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(ERR.VALIDATION(`مقدار «${field}» باید بولی باشد.`));
  }
  return value;
}

// ---- general settings (site identity, support contacts, maintenance) ----

export interface GeneralSettings {
  siteNameFa: string;
  siteTaglineFa: string;
  supportEmail: string;
  supportPhone: string;
  supportTelegramUrl: string;
  supportBaleUrl: string;
  termsNoteFa: string;
  maintenanceEnabled: boolean;
  maintenanceMessageFa: string;
}

const GENERAL_LIMITS: Record<'siteNameFa' | 'siteTaglineFa' | 'supportEmail' | 'supportPhone' | 'supportTelegramUrl' | 'supportBaleUrl' | 'termsNoteFa' | 'maintenanceMessageFa', number> = {
  siteNameFa: 60,
  siteTaglineFa: 120,
  supportEmail: 190,
  supportPhone: 20,
  supportTelegramUrl: 190,
  supportBaleUrl: 190,
  termsNoteFa: 300,
  maintenanceMessageFa: 300,
};

const GENERAL_DEFAULTS: GeneralSettings = {
  siteNameFa: 'پُست‌یار',
  siteTaglineFa: '',
  supportEmail: '',
  supportPhone: '',
  supportTelegramUrl: '',
  supportBaleUrl: '',
  termsNoteFa: '',
  maintenanceEnabled: false,
  maintenanceMessageFa: '',
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const doc = await readSettingDoc('general');
  const s: GeneralSettings = { ...GENERAL_DEFAULTS };
  const str = (k: keyof typeof GENERAL_LIMITS): string | undefined => {
    const v = doc[k];
    return typeof v === 'string' ? v.trim().slice(0, GENERAL_LIMITS[k]) : undefined;
  };
  const siteName = str('siteNameFa');
  if (siteName) s.siteNameFa = siteName; // default is non-empty — never blank
  s.siteTaglineFa = str('siteTaglineFa') ?? s.siteTaglineFa;
  s.supportEmail = str('supportEmail') ?? s.supportEmail;
  s.supportPhone = str('supportPhone') ?? s.supportPhone;
  s.supportTelegramUrl = str('supportTelegramUrl') ?? s.supportTelegramUrl;
  s.supportBaleUrl = str('supportBaleUrl') ?? s.supportBaleUrl;
  s.termsNoteFa = str('termsNoteFa') ?? s.termsNoteFa;
  if (typeof doc['maintenanceEnabled'] === 'boolean') s.maintenanceEnabled = doc['maintenanceEnabled'];
  s.maintenanceMessageFa = str('maintenanceMessageFa') ?? s.maintenanceMessageFa;
  return s;
}

export interface GeneralSettingsPatch {
  siteNameFa?: string;
  siteTaglineFa?: string;
  supportEmail?: string;
  supportPhone?: string;
  supportTelegramUrl?: string;
  supportBaleUrl?: string;
  termsNoteFa?: string;
  maintenanceEnabled?: boolean;
  maintenanceMessageFa?: string;
}

export async function putGeneralSettings(patch: GeneralSettingsPatch): Promise<string[]> {
  const merged: GeneralSettings = await getGeneralSettings();
  const updated: string[] = [];
  if (patch.siteNameFa !== undefined) {
    const v = ensureDocStr(patch.siteNameFa, 'siteNameFa', GENERAL_LIMITS.siteNameFa);
    if (v === '') throw new AppError(ERR.VALIDATION('نام سایت الزامی است.'));
    merged.siteNameFa = v;
    updated.push('siteNameFa');
  }
  if (patch.siteTaglineFa !== undefined) {
    merged.siteTaglineFa = ensureDocStr(patch.siteTaglineFa, 'siteTaglineFa', GENERAL_LIMITS.siteTaglineFa);
    updated.push('siteTaglineFa');
  }
  if (patch.supportEmail !== undefined) {
    const v = ensureDocStr(patch.supportEmail, 'supportEmail', GENERAL_LIMITS.supportEmail);
    if (v !== '' && !v.includes('@')) throw new AppError(ERR.VALIDATION('ایمیل پشتیبانی معتبر نیست.'));
    merged.supportEmail = v;
    updated.push('supportEmail');
  }
  if (patch.supportPhone !== undefined) {
    merged.supportPhone = ensureDocStr(patch.supportPhone, 'supportPhone', GENERAL_LIMITS.supportPhone);
    updated.push('supportPhone');
  }
  if (patch.supportTelegramUrl !== undefined) {
    const v = ensureDocStr(patch.supportTelegramUrl, 'supportTelegramUrl', GENERAL_LIMITS.supportTelegramUrl);
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس تلگرام باید با https:// شروع شود.'));
    }
    merged.supportTelegramUrl = v;
    updated.push('supportTelegramUrl');
  }
  if (patch.supportBaleUrl !== undefined) {
    const v = ensureDocStr(patch.supportBaleUrl, 'supportBaleUrl', GENERAL_LIMITS.supportBaleUrl);
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس بله باید با https:// شروع شود.'));
    }
    merged.supportBaleUrl = v;
    updated.push('supportBaleUrl');
  }
  if (patch.termsNoteFa !== undefined) {
    merged.termsNoteFa = ensureDocStr(patch.termsNoteFa, 'termsNoteFa', GENERAL_LIMITS.termsNoteFa);
    updated.push('termsNoteFa');
  }
  if (patch.maintenanceEnabled !== undefined) {
    merged.maintenanceEnabled = ensureDocBool(patch.maintenanceEnabled, 'maintenanceEnabled');
    updated.push('maintenanceEnabled');
  }
  if (patch.maintenanceMessageFa !== undefined) {
    merged.maintenanceMessageFa = ensureDocStr(patch.maintenanceMessageFa, 'maintenanceMessageFa', GENERAL_LIMITS.maintenanceMessageFa);
    updated.push('maintenanceMessageFa');
  }
  await upsertSetting('general', merged);
  return updated;
}

// ---- ai settings (provider + global key / custom endpoint) ---------------

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiSettings {
  default_provider: AiProviderId;
  hasApiKey: boolean;
  apiKeyMasked: string;
  customBaseUrl: string;
  customModel: string;
}

const AI_DEFAULTS: AiSettings = { default_provider: 'openai', hasApiKey: false, apiKeyMasked: '', customBaseUrl: '', customModel: '' };

const AI_DOC_LIMITS = { apiKey: 190, customBaseUrl: 190, customModel: 80 } as const;

/** Masked view of the stored global AI key — the raw key NEVER leaves the server. */
function maskApiKey(key: string): string {
  return key.length > 0 ? `••••${key.slice(-4)}` : '';
}

export async function getAiSettings(): Promise<AiSettings> {
  const doc = await readSettingDoc('ai');
  const rawProvider = doc['default_provider'];
  const s: AiSettings = { ...AI_DEFAULTS };
  if (typeof rawProvider === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(rawProvider.toLowerCase())) {
    s.default_provider = rawProvider.toLowerCase() as AiProviderId;
  }
  const rawKey = doc['apiKey'];
  if (typeof rawKey === 'string' && rawKey !== '') {
    s.hasApiKey = true;
    s.apiKeyMasked = maskApiKey(rawKey);
  }
  const baseUrl = doc['customBaseUrl'];
  if (typeof baseUrl === 'string') s.customBaseUrl = baseUrl.trim().slice(0, AI_DOC_LIMITS.customBaseUrl);
  const model = doc['customModel'];
  if (typeof model === 'string') s.customModel = model.trim().slice(0, AI_DOC_LIMITS.customModel);
  return s;
}

export interface AiSettingsPatch {
  default_provider?: AiProviderId;
  /** Write-only: stored as-is; '' clears the stored key. Never echoed back. */
  api_key?: string;
  custom_base_url?: string;
  custom_model?: string;
}

export async function putAiSettings(patch: AiSettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('ai')) };
  const updated: string[] = [];
  if (patch.default_provider !== undefined) {
    if (!(AI_PROVIDER_IDS as readonly string[]).includes(patch.default_provider)) {
      throw new AppError(ERR.VALIDATION('سرویس‌دهندهٔ هوش مصنوعی معتبر نیست.'));
    }
    // EXACT field name — ai.service.resolveProvider() reads 'default_provider'.
    merged['default_provider'] = patch.default_provider;
    updated.push('default_provider');
  }
  if (patch.api_key !== undefined) {
    const v = ensureDocStr(patch.api_key, 'api_key', AI_DOC_LIMITS.apiKey);
    // Stored as-is; empty string clears the key (env fallback resumes).
    merged['apiKey'] = v;
    updated.push('api_key');
  }
  if (patch.custom_base_url !== undefined) {
    const v = ensureDocStr(patch.custom_base_url, 'custom_base_url', AI_DOC_LIMITS.customBaseUrl);
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس سفارشی هوش مصنوعی باید با https:// شروع شود.'));
    }
    merged['customBaseUrl'] = v;
    updated.push('custom_base_url');
  }
  if (patch.custom_model !== undefined) {
    merged['customModel'] = ensureDocStr(patch.custom_model, 'custom_model', AI_DOC_LIMITS.customModel);
    updated.push('custom_model');
  }
  await upsertSetting('ai', merged);
  return updated;
}

// ---- AI runtime override (round 18) ---------------------------------------

export interface AiRuntimeOverride {
  key?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Reads the 'ai' document and returns ONLY non-empty override fields for the
 * runtime AI call. The stored key applies to every provider; customBaseUrl /
 * customModel apply ONLY to the OpenAI-compatible adapters — gemini/anthropic
 * keep their fixed code-controlled URLs and models (§28).
 */
export async function resolveAiRuntimeOverride(provider: string): Promise<AiRuntimeOverride> {
  const doc = await readSettingDoc('ai');
  const out: AiRuntimeOverride = {};
  const rawKey = doc['apiKey'];
  if (typeof rawKey === 'string' && rawKey.trim() !== '') out.key = rawKey;
  const p = provider.toLowerCase();
  if (p === 'gemini' || p === 'anthropic') return out;
  const rawBaseUrl = doc['customBaseUrl'];
  if (typeof rawBaseUrl === 'string' && rawBaseUrl.trim() !== '') out.baseUrl = rawBaseUrl;
  const rawModel = doc['customModel'];
  if (typeof rawModel === 'string' && rawModel.trim() !== '') out.model = rawModel;
  return out;
}

// ---- referral settings (register reward, first-purchase percent) ---------

export interface ReferralSettings {
  registerRewardPoints: number;
  enabled: boolean;
  firstPurchasePercent: number;
}

export const REFERRAL_POINTS_MIN = 0;
export const REFERRAL_POINTS_MAX = 100000;
export const REFERRAL_PERCENT_MIN = 0;
export const REFERRAL_PERCENT_MAX = 50;
const REFERRAL_DEFAULTS: ReferralSettings = { registerRewardPoints: 100, enabled: true, firstPurchasePercent: 10 };

export async function getReferralSettings(): Promise<ReferralSettings> {
  const doc = await readSettingDoc('referral');
  const s: ReferralSettings = { ...REFERRAL_DEFAULTS };
  const rawPoints = doc['registerRewardPoints'];
  if (
    typeof rawPoints === 'number' &&
    Number.isInteger(rawPoints) &&
    rawPoints >= REFERRAL_POINTS_MIN &&
    rawPoints <= REFERRAL_POINTS_MAX
  ) {
    s.registerRewardPoints = rawPoints;
  }
  if (typeof doc['enabled'] === 'boolean') s.enabled = doc['enabled'];
  const rawPercent = doc['firstPurchasePercent'];
  if (
    typeof rawPercent === 'number' &&
    Number.isInteger(rawPercent) &&
    rawPercent >= REFERRAL_PERCENT_MIN &&
    rawPercent <= REFERRAL_PERCENT_MAX
  ) {
    s.firstPurchasePercent = rawPercent;
  }
  return s;
}

export interface ReferralSettingsPatch {
  registerRewardPoints?: number;
  enabled?: boolean;
  firstPurchasePercent?: number;
}

export async function putReferralSettings(patch: ReferralSettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('referral')) };
  const updated: string[] = [];
  if (patch.registerRewardPoints !== undefined) {
    const v = patch.registerRewardPoints;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < REFERRAL_POINTS_MIN || v > REFERRAL_POINTS_MAX) {
      throw new AppError(ERR.VALIDATION('امتیاز پاداش معرفی باید عدد صحیح بین ۰ تا ۱۰۰۰۰۰ باشد.'));
    }
    merged['registerRewardPoints'] = v;
    updated.push('registerRewardPoints');
  }
  if (patch.enabled !== undefined) {
    merged['enabled'] = ensureDocBool(patch.enabled, 'enabled');
    updated.push('enabled');
  }
  if (patch.firstPurchasePercent !== undefined) {
    const v = patch.firstPurchasePercent;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < REFERRAL_PERCENT_MIN || v > REFERRAL_PERCENT_MAX) {
      throw new AppError(ERR.VALIDATION('درصد پاداش خرید اول باید عددی بین ۰ تا ۵۰ باشد.'));
    }
    merged['firstPurchasePercent'] = v;
    updated.push('firstPurchasePercent');
  }
  await upsertSetting('referral', merged);
  return updated;
}

// ---- gold ticker bot defaults (asovin «تنظیمات ربات طلا» parity) ---------

export interface GoldSettings {
  defaultSourceUrl: string;
  defaultFrequencyMinutes: number;
  defaultTemplateFa: string;
}

const GOLD_DEFAULTS: GoldSettings = { defaultSourceUrl: '', defaultFrequencyMinutes: 60, defaultTemplateFa: '' };
const GOLD_LIMITS = { defaultSourceUrl: 190, defaultTemplateFa: 2000 } as const;
const GOLD_FREQUENCY_MIN = 15;
const GOLD_FREQUENCY_MAX = 1440;

export async function getGoldSettings(): Promise<GoldSettings> {
  const doc = await readSettingDoc('gold');
  const s: GoldSettings = { ...GOLD_DEFAULTS };
  const rawUrl = doc['defaultSourceUrl'];
  if (typeof rawUrl === 'string') s.defaultSourceUrl = rawUrl.trim().slice(0, GOLD_LIMITS.defaultSourceUrl);
  const rawFreq = doc['defaultFrequencyMinutes'];
  if (
    typeof rawFreq === 'number' &&
    Number.isInteger(rawFreq) &&
    rawFreq >= GOLD_FREQUENCY_MIN &&
    rawFreq <= GOLD_FREQUENCY_MAX
  ) {
    s.defaultFrequencyMinutes = rawFreq;
  }
  const rawTemplate = doc['defaultTemplateFa'];
  if (typeof rawTemplate === 'string') s.defaultTemplateFa = rawTemplate.slice(0, GOLD_LIMITS.defaultTemplateFa);
  return s;
}

export interface GoldSettingsPatch {
  defaultSourceUrl?: string;
  defaultFrequencyMinutes?: number;
  defaultTemplateFa?: string;
}

export async function putGoldSettings(patch: GoldSettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('gold')) };
  const updated: string[] = [];
  if (patch.defaultSourceUrl !== undefined) {
    const v = ensureDocStr(patch.defaultSourceUrl, 'defaultSourceUrl', GOLD_LIMITS.defaultSourceUrl);
    // Scheme-only validation here: the FULL SSRF check (assertSafeUrl) still
    // happens on the user-side save paths in gold.service.saveGoldConfig.
    if (v !== '' && !v.startsWith('https://')) {
      throw new AppError(ERR.VALIDATION('آدرس منبع پیش‌فرض باید با https:// شروع شود.'));
    }
    merged['defaultSourceUrl'] = v;
    updated.push('defaultSourceUrl');
  }
  if (patch.defaultFrequencyMinutes !== undefined) {
    const v = patch.defaultFrequencyMinutes;
    if (
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      v < GOLD_FREQUENCY_MIN ||
      v > GOLD_FREQUENCY_MAX
    ) {
      throw new AppError(ERR.VALIDATION('فاصلهٔ به‌روزرسانی پیش‌فرض باید بین ۱۵ تا ۱۴۴۰ دقیقه باشد.'));
    }
    merged['defaultFrequencyMinutes'] = v;
    updated.push('defaultFrequencyMinutes');
  }
  if (patch.defaultTemplateFa !== undefined) {
    merged['defaultTemplateFa'] = ensureDocStr(patch.defaultTemplateFa, 'defaultTemplateFa', GOLD_LIMITS.defaultTemplateFa);
    updated.push('defaultTemplateFa');
  }
  await upsertSetting('gold', merged);
  return updated;
}

// ---- security settings (registration toggle, captcha toggle) -------------

export interface SecuritySettings {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
}

const SECURITY_DEFAULTS: SecuritySettings = { registrationEnabled: true, captchaEnabled: true };

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const doc = await readSettingDoc('security');
  const s: SecuritySettings = { ...SECURITY_DEFAULTS };
  if (typeof doc['registrationEnabled'] === 'boolean') s.registrationEnabled = doc['registrationEnabled'];
  if (typeof doc['captchaEnabled'] === 'boolean') s.captchaEnabled = doc['captchaEnabled'];
  return s;
}

export interface SecuritySettingsPatch {
  registrationEnabled?: boolean;
  captchaEnabled?: boolean;
}

export async function putSecuritySettings(patch: SecuritySettingsPatch): Promise<string[]> {
  const merged = { ...(await readSettingDoc('security')) };
  const updated: string[] = [];
  if (patch.registrationEnabled !== undefined) {
    merged['registrationEnabled'] = ensureDocBool(patch.registrationEnabled, 'registrationEnabled');
    updated.push('registrationEnabled');
  }
  if (patch.captchaEnabled !== undefined) {
    merged['captchaEnabled'] = ensureDocBool(patch.captchaEnabled, 'captchaEnabled');
    updated.push('captchaEnabled');
  }
  await upsertSetting('security', merged);
  return updated;
}
