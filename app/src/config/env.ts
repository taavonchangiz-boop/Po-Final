/**
 * Zod-validated environment configuration.
 * Fails fast in production when mandatory settings are missing.
 * In development/test, ephemeral insecure dev secrets are generated (clearly flagged).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const HEX64 = /^[0-9a-fA-F]{64}$/;

const isEncryptionKeyShape = (v: string): boolean => v.length === 32 || HEX64.test(v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3001'),

  // Infrastructure
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).optional(),

  // Security secrets
  SESSION_SECRET: z.string().optional(),
  CSRF_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z
    .string()
    .refine(isEncryptionKeyShape, 'ENCRYPTION_KEY must be exactly 32 chars or 64 hex chars')
    .optional(),

  // Mail (optional provider config)
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().optional(),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // SMS (optional provider config)
  SMS_PROVIDER: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER: z.string().optional(),

  // Server-level provider fallback tokens (used when a tenant has none)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  BALE_BOT_TOKEN: z.string().optional(),
  RUBIKA_BOT_TOKEN: z.string().optional(),

  // AI provider keys (server-level fallback)
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  CLAUDE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),

  // Payment gateway
  PAYMENT_PROVIDER: z.enum(['ZARINPAL', 'IDPAY', 'ZIBAL', 'MOCK']).optional(),
  PAYMENT_MERCHANT_ID: z.string().optional(),
  PAYMENT_API_KEY: z.string().optional(),

  // Ops
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  STORAGE_DIR: z.string().default('../storage'),
  SEED_TOKEN: z.string().optional(),
  /** Deliberate escape hatch for MOCK payment gateway in production (tests/demo only). */
  ALLOW_MOCK_PAYMENTS: z.enum(['true', 'false']).default('false'),
});

export type Env = Readonly<
  Omit<z.infer<typeof EnvSchema>, 'SESSION_SECRET' | 'CSRF_SECRET' | 'ENCRYPTION_KEY'> & {
    SESSION_SECRET: string;
    CSRF_SECRET: string;
    ENCRYPTION_KEY: string;
    isProduction: boolean;
    devSecretsGenerated: boolean;
  }
>;

function requireInProduction(res: { NODE_ENV: string; REDIS_URL?: string; SESSION_SECRET?: string; CSRF_SECRET?: string; ENCRYPTION_KEY?: string }): string[] {
  const missing: string[] = [];
  if (res.NODE_ENV !== 'production') return missing;
  if (!res.REDIS_URL) missing.push('REDIS_URL');
  if (!res.SESSION_SECRET || res.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (min 32 chars)');
  if (!res.CSRF_SECRET || res.CSRF_SECRET.length < 32) missing.push('CSRF_SECRET (min 32 chars)');
  if (!res.ENCRYPTION_KEY || !isEncryptionKeyShape(res.ENCRYPTION_KEY)) missing.push('ENCRYPTION_KEY (32 chars or 64 hex chars)');
  return missing;
}

function buildEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  const res = parsed.data;
  const missing = requireInProduction(res);
  if (missing.length > 0) {
    throw new Error(
      `Missing mandatory environment variables for production: ${missing.join(', ')}. ` +
        'Set them in the process environment before starting the server.',
    );
  }

  let devSecretsGenerated = false;
  const isDev = res.NODE_ENV === 'development' || res.NODE_ENV === 'test';
  let sessionSecret = res.SESSION_SECRET;
  let csrfSecret = res.CSRF_SECRET;
  let encryptionKey = res.ENCRYPTION_KEY;

  if (isDev && (!sessionSecret || sessionSecret.length < 32)) {
    sessionSecret = randomBytes(32).toString('hex');
    devSecretsGenerated = true;
    console.warn(
      '[postyar:env] WARNING: SESSION_SECRET not set — an EPHEMERAL dev secret was generated. ' +
        'Sessions will be invalidated on restart. INSECURE DEFAULT, never use in production.',
    );
  }
  if (isDev && (!csrfSecret || csrfSecret.length < 32)) {
    csrfSecret = randomBytes(32).toString('hex');
    devSecretsGenerated = true;
    console.warn(
      '[postyar:env] WARNING: CSRF_SECRET not set — an EPHEMERAL dev secret was generated. INSECURE DEFAULT, never use in production.',
    );
  }
  if (isDev && !encryptionKey) {
    encryptionKey = randomBytes(32).toString('hex');
    devSecretsGenerated = true;
    console.warn(
      '[postyar:env] WARNING: ENCRYPTION_KEY not set — an EPHEMERAL dev key was generated. ' +
        'Data encrypted with it cannot be decrypted after restart. INSECURE DEFAULT, never use in production.',
    );
  }

  return Object.freeze({
    ...res,
    SESSION_SECRET: sessionSecret as string,
    CSRF_SECRET: csrfSecret as string,
    ENCRYPTION_KEY: encryptionKey as string,
    isProduction: res.NODE_ENV === 'production',
    devSecretsGenerated,
  });
}

export const env: Env = buildEnv();
