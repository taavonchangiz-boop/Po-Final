import { z } from 'zod';

/**
 * Central, validated environment configuration (contract §90).
 * Fails fast and clearly when mandatory production configuration is missing.
 * Never silently falls back to insecure defaults for secrets.
 */
const boolish = (v: string) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 chars'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes for AES-256-GCM)'),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().optional(),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  SMS_PROVIDER: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  PAYMENT_PROVIDER: z.string().default('zarinpal'),
  PAYMENT_MERCHANT_ID: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(20).default(5),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  SCHEDULER_LOCK_KEY: z.string().default('postyar:scheduler:lock'),
  DISABLE_QUEUE: z
    .string()
    .optional()
    .transform((v) => (v ? boolish(v) : false)),
});

export type Env = z.infer<typeof baseSchema>;

let cached: Env | null = null;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = baseSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    // eslint-disable-next-line no-console
    console.error(`[config] Invalid environment configuration: ${details}`);
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}
