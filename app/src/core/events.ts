/**
 * Analytics kernel: append-only events + audit logs (ADR-011).
 * Fire-and-forget writes; data is sanitized (secret keys stripped, depth/size capped).
 */
import { db } from '../db/client.js';
import { auditLogs, events } from '../db/schema.js';
import { logger } from './logger.js';

const SECRET_KEY_RE = /token|secret|password|authorization|cookie|key/i;
const MAX_DEPTH = 3;
const MAX_JSON_BYTES = 4096;
const REDACTED = '[REDACTED]';

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? REDACTED : sanitizeValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500);
  return value;
}

function sanitizeData(data: unknown): Record<string, unknown> {
  const cleaned = sanitizeValue(data, 0);
  if (cleaned === null || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
    return cleaned === null ? {} : { value: cleaned };
  }
  const json = JSON.stringify(cleaned);
  if (json.length <= MAX_JSON_BYTES) return cleaned as Record<string, unknown>;
  return { truncated: true, originalBytes: Buffer.byteLength(json, 'utf8') };
}

export interface TrackEventInput {
  userId?: number | null;
  type: string;
  subjectType?: string;
  subjectId?: number;
  data?: Record<string, unknown>;
}

export interface TrackAuditInput {
  actorUserId?: number | null;
  action: string;
  subjectType?: string;
  subjectId?: number;
  ip?: string;
  userAgent?: string;
  data?: Record<string, unknown>;
}

function clip(v: string | undefined, max: number): string | undefined {
  if (v === undefined) return undefined;
  return v.slice(0, max);
}

export const AnalyticsService = {
  /** Fire-and-forget analytics event (never throws). */
  trackEvent(input: TrackEventInput): void {
    db.insert(events)
      .values({
        userId: input.userId ?? null,
        type: input.type.slice(0, 60),
        subjectType: clip(input.subjectType, 40),
        subjectId: input.subjectId ?? null,
        data: sanitizeData(input.data ?? {}),
      })
      .catch((err: unknown) => {
        logger.warn('event_insert_failed', {
          type: input.type,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  },

  /** Fire-and-forget audit log entry (never throws). */
  trackAudit(input: TrackAuditInput): void {
    db.insert(auditLogs)
      .values({
        actorUserId: input.actorUserId ?? null,
        action: input.action.slice(0, 60),
        subjectType: clip(input.subjectType, 40),
        subjectId: input.subjectId ?? null,
        ip: clip(input.ip, 45),
        userAgent: clip(input.userAgent, 255),
        data: sanitizeData(input.data ?? {}),
      })
      .catch((err: unknown) => {
        logger.warn('audit_insert_failed', {
          action: input.action,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  },
};
