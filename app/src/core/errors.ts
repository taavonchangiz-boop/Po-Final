/**
 * Application error model: stable error codes + error classification for
 * delivery/provider retry decisions (transient vs permanent etc.).
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT'
  | 'PAYMENT_ERROR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

/** Retry-decision class (delivery state machine / worker backoff). */
export type ErrorClass =
  | 'Transient'
  | 'Permanent'
  | 'Validation'
  | 'Authentication'
  | 'Authorization'
  | 'RateLimited'
  | 'Provider'
  | 'Network'
  | 'Internal';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** When false, the error handler emits a generic message (never leaks internals). */
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown, expose = true) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
  }

  /** Fastify-compatible alias so AppError satisfies the FastifyError shape. */
  get statusCode(): number {
    return this.status;
  }
}

const GENERIC_INTERNAL_MESSAGE = 'خطای داخلی سرور. لطفاً بعداً تلاش کنید.';

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', message, 400, details);
}
export function unauthenticated(message = 'برای ادامه باید وارد حساب خود شوید.'): AppError {
  return new AppError('UNAUTHENTICATED', message, 401);
}
export function forbidden(message = 'شما به این بخش دسترسی ندارید.'): AppError {
  return new AppError('FORBIDDEN', message, 403);
}
export function notFound(message = 'موردی یافت نشد.'): AppError {
  return new AppError('NOT_FOUND', message, 404);
}
export function conflict(message: string): AppError {
  return new AppError('CONFLICT', message, 409);
}
export function rateLimited(message = 'درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.'): AppError {
  return new AppError('RATE_LIMITED', message, 429);
}
export function planLimit(message: string): AppError {
  return new AppError('PLAN_LIMIT', message, 402);
}
export function paymentError(message: string): AppError {
  return new AppError('PAYMENT_ERROR', message, 402);
}
export function providerError(message: string): AppError {
  return new AppError('PROVIDER_ERROR', message, 502);
}
/** Internal error: details kept server-side, client gets a generic message. */
export function internal(err: unknown): AppError {
  const details = err instanceof Error ? err.message : String(err);
  return new AppError('INTERNAL_ERROR', GENERIC_INTERNAL_MESSAGE, 500, details, false);
}

const HTTP_STATUS_CLASS: ReadonlyMap<number, ErrorClass> = new Map([
  [400, 'Validation'],
  [401, 'Authentication'],
  [402, 'Permanent'],
  [403, 'Authorization'],
  [404, 'Permanent'],
  [405, 'Permanent'],
  [408, 'Transient'],
  [409, 'Permanent'],
  [410, 'Permanent'],
  [413, 'Validation'],
  [414, 'Validation'],
  [415, 'Validation'],
  [422, 'Validation'],
  [429, 'RateLimited'],
  [431, 'Validation'],
  [451, 'Permanent'],
  [501, 'Permanent'],
  [502, 'Transient'],
  [503, 'Transient'],
  [504, 'Transient'],
]);

/** Map an HTTP status (typically from a provider response) to an ErrorClass. */
export function classifyHttpError(status: number): ErrorClass {
  return HTTP_STATUS_CLASS.get(status) ?? (status < 500 ? 'Permanent' : 'Transient');
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'ABORT_ERR',
]);

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  name?: unknown;
  message?: unknown;
}

function isAbortError(err: ErrorLike): boolean {
  return (
    err.code === 'ABORT_ERR' ||
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    (typeof err.message === 'string' && /operation was aborted|timed?\s*out/i.test(err.message))
  );
}

function hasName(err: unknown): err is ErrorLike & { name?: unknown } {
  return typeof err === 'object' && err !== null;
}

/** Classify a provider/API failure for retry decisions. Unknown failures default to Transient. */
export function classifyProviderError(err: unknown): ErrorClass {
  if (err instanceof AppError) {
    if (err.code === 'VALIDATION_ERROR') return 'Validation';
    if (err.code === 'UNAUTHENTICATED') return 'Authentication';
    if (err.code === 'FORBIDDEN') return 'Authorization';
    if (err.code === 'RATE_LIMITED') return 'RateLimited';
    if (err.code === 'PROVIDER_ERROR') return 'Provider';
    if (err.code === 'INTERNAL_ERROR') return 'Internal';
    return 'Permanent';
  }
  if (!hasName(err)) return 'Transient';
  const e = err as ErrorLike & { name?: unknown };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (status !== undefined) return classifyHttpError(status);
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return 'Network';
  if (isAbortError(e)) return 'Network';
  if (typeof e.message === 'string' && /timeout|socket hang up|network|ECONN|fetch failed/i.test(e.message)) return 'Network';
  return 'Transient';
}
