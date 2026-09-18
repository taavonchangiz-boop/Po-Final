/**
 * Typed fetch wrapper for the Postyar API.
 *
 * Contract (docs/contracts/api-contract.md):
 *  - Same origin, base namespace /api/v1, session cookie auth (credentials: include).
 *  - CSRF double-submit: non-GET requests send `X-CSRF-Token` header read from
 *    the `py_csrf` cookie.
 *  - Envelope: `{ success: true, data }` or `{ success: false, error: { code, message, requestId } }`.
 *  - On 401 a `postyar:unauthorized` window event is dispatched so the app shell
 *    can present the auth modal.
 */

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: string, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
}

type Envelope<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

function readCookie(name: string): string | null {
  const prefix = name + '=';
  for (const part of document.cookie.split(';')) {
    const raw = part.trim();
    if (raw.startsWith(prefix)) return decodeURIComponent(raw.slice(prefix.length));
  }
  return null;
}

function dispatchUnauthorized(): void {
  window.dispatchEvent(new CustomEvent('postyar:unauthorized'));
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') {
    const csrf = readCookie('py_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      credentials: 'include',
      body: payload,
    });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.', 0, 'NETWORK_ERROR');
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    envelope = null;
  }

  if (!res.ok || !envelope || envelope.success !== true) {
    const err = envelope && envelope.success === false ? envelope.error : undefined;
    if (res.status === 401) dispatchUnauthorized();
    throw new ApiError(
      err?.message ?? 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.',
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.requestId ?? null,
    );
  }

  return envelope.data;
}

/** GET — typed. */
export function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

/** POST — typed. */
export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

/** PATCH — typed. */
export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body);
}

/** PUT — typed. */
export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

/** DELETE — typed. */
export function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}
