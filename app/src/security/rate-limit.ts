/**
 * Rate-limit registration + per-route presets (global limiter disabled).
 * Presets are spread into route options: { ...authLimiter }.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

const MINUTE = '1 minute';

function userOrIpKey(request: FastifyRequest): string {
  const user = request.currentUser;
  return user !== undefined ? `u:${user.id}` : `ip:${request.ip}`;
}

function ipKey(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

export interface RateLimitPreset {
  config: {
    rateLimit: {
      max: number;
      timeWindow: string;
      keyGenerator: (request: FastifyRequest) => string;
    };
  };
}

/** Auth endpoints: 10/min per IP. */
export const authLimiter: RateLimitPreset = {
  config: { rateLimit: { max: 10, timeWindow: MINUTE, keyGenerator: ipKey } },
};

/** AI endpoints: 20/min per user. */
export const aiLimiter: RateLimitPreset = {
  config: { rateLimit: { max: 20, timeWindow: MINUTE, keyGenerator: userOrIpKey } },
};

/** Publishing endpoints: 60/min per user. */
export const publishLimiter: RateLimitPreset = {
  config: { rateLimit: { max: 60, timeWindow: MINUTE, keyGenerator: userOrIpKey } },
};

/** Public webhook endpoints: 300/min per IP. */
export const webhookLimiter: RateLimitPreset = {
  config: { rateLimit: { max: 300, timeWindow: MINUTE, keyGenerator: ipKey } },
};

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { global: false });
}
