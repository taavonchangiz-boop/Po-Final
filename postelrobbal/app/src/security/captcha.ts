import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import svgCaptcha from 'svg-captcha';
import { loadEnv } from '../config/env.js';

/**
 * Graphical anti-bot captcha (item 15).
 * Codes live ONLY in Redis with a 5-minute TTL and are consumed atomically
 * on the first verification attempt (GETDEL) — one shot per issued code,
 * no brute-force window. Failing closed: any Redis problem rejects the flow.
 */
const CAPTCHA_PREFIX = 'captcha:';
const CAPTCHA_TTL_SECONDS = 300;

// Ambiguity-free character set (default a-z0-9 preset minus look-alikes).
const IGNORE_CHARS = '0oO1ilI';

let client: Redis | null = null;

/** Lazy singleton Redis client dedicated to short-lived captcha codes. */
function captchaRedis(): Redis {
  if (client) return client;
  const env = loadEnv();
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  return client;
}

export function issueCaptcha(): Promise<{ captchaId: string; svg: string }> {
  const { data, text } = svgCaptcha.create({
    size: 5,
    noise: 3,
    color: true,
    background: 'rgba(226,232,240,0.35)',
    width: 170,
    height: 60,
    ignoreChars: IGNORE_CHARS,
  });
  const captchaId = randomBytes(16).toString('hex'); // 32 hex chars
  const redis = captchaRedis();
  return redis
    .set(CAPTCHA_PREFIX + captchaId, text.toLowerCase(), 'EX', CAPTCHA_TTL_SECONDS)
    .then(() => ({ captchaId, svg: data }));
}

export async function verifyCaptcha(captchaId: string, text: string): Promise<boolean> {
  // Reject malformed ids before touching Redis (guards the key space).
  if (!/^[0-9a-f]{32}$/.test(captchaId)) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length < 3 || normalized.length > 10) return false;

  const redis = captchaRedis();
  const key = CAPTCHA_PREFIX + captchaId;
  try {
    // GETDEL consumes the code atomically → exactly one verification attempt.
    const stored = await redis.getdel(key);
    return stored !== null && stored === normalized;
  } catch (err) {
    // Older Redis (< 6.2): atomic MULTI GET+DEL transaction keeps one-shot semantics.
    const msg = err instanceof Error ? err.message : '';
    if (/unknown command/i.test(msg)) {
      try {
        const res = await redis.multi().get(key).del(key).exec();
        const stored = res?.[0]?.[1];
        return typeof stored === 'string' && stored === normalized;
      } catch {
        return false;
      }
    }
    return false; // fail closed
  }
}

/** Graceful shutdown hook (symmetry with queue/connection.ts). */
export async function closeCaptchaStore(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
  }
}
