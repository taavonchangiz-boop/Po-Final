/**
 * Zero-dependency structured JSON logger (pino-style interface).
 * - One JSON line per event on stdout.
 * - Redacts values of keys matching /token|secret|password|authorization|cookie|key/i.
 * - childLogger(bindings) merges context into every line (e.g. requestId).
 */
import { env } from '../config/env.js';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const REDACT_KEY_RE = /token|secret|password|authorization|cookie|key/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;

export type LogContext = Record<string, unknown>;

export interface Logger {
  fatal(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  trace(msg: string, ctx?: LogContext): void;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === 'string' ? value.stack.split('\n').slice(0, 5).join('\n') : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_RE.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[TRUNCATED]`;
  return value;
}

function redact(ctx: LogContext | undefined): LogContext | undefined {
  if (ctx === undefined) return undefined;
  const out: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = REDACT_KEY_RE.test(k) ? REDACTED : redactValue(v, 1);
  }
  return out;
}

interface InternalLogger extends Logger {
  readonly level: LogLevel;
}

function createLogger(bindings: LogContext, minWeight: number): InternalLogger {
  const write = (level: LogLevel, msg: string, ctx?: LogContext): void => {
    if (LEVEL_WEIGHT[level] < minWeight) return;
    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...redact(bindings),
      msg,
      ...(ctx === undefined ? {} : redact(ctx)),
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  };

  return {
    level: (Object.keys(LEVEL_WEIGHT) as LogLevel[]).reverse().find((l) => LEVEL_WEIGHT[l] === minWeight) ?? 'info',
    fatal: (msg, ctx) => write('fatal', msg, ctx),
    error: (msg, ctx) => write('error', msg, ctx),
    warn: (msg, ctx) => write('warn', msg, ctx),
    info: (msg, ctx) => write('info', msg, ctx),
    debug: (msg, ctx) => write('debug', msg, ctx),
    trace: (msg, ctx) => write('trace', msg, ctx),
  };
}

const minWeight = LEVEL_WEIGHT[env.LOG_LEVEL];

export const logger: Logger = createLogger({ app: 'postyar' }, minWeight);

export function childLogger(bindings: LogContext): Logger {
  return createLogger({ app: 'postyar', ...bindings }, minWeight);
}
