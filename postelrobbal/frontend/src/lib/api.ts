/**
 * Typed API client. Session = HttpOnly cookie (never localStorage, §40).
 * CSRF token (not auth material) held in memory/sessionStorage.
 */
export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let csrfToken: string | null = sessionStorage.getItem('py_csrf');

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? null;
  if (token) sessionStorage.setItem('py_csrf', token);
  else sessionStorage.removeItem('py_csrf');
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = csrfToken;
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.formData
      ? options.formData
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.',
      res.status
    );
  }
  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  /** Multipart upload (support attachments, payment receipts). The browser
   *  sets the multipart boundary header; never set content-type manually. */
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Shared types mirroring the API contract (§84). */
export interface MeResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    businessName: string;
    role: string;
    /* Task 17-b avatar fields (avatarKind 'character' | 'photo'). */
    avatarKind?: 'character' | 'photo';
    avatarValue?: string;
    avatarMediaId?: string | null;
  };
  subscription: { id: string; state: string; expiresAt: string; planName: string; planCode: string } | null;
  csrfToken: string;
}

/** Same-origin URL of a user's photo avatar (cookies ride along). */
export function avatarPhotoUrl(userId: string, avatarMediaId?: string | null): string | undefined {
  const bust = avatarMediaId ? `?v=${encodeURIComponent(avatarMediaId)}` : '';
  return `/api/v1/users/${userId}/avatar${bust}`;
}

export interface PlanDto {
  id: string;
  code: string;
  nameFa: string;
  priceRial: number;
  periodDays: number;
  limitsJson: { max_channels: number; max_posts: number; max_bots: number; max_schedules: number; ai_monthly: number; storage_mb: number };
  featuresJson: { gold_ticker: boolean; auto_responder: boolean; woocommerce: boolean; api_access: boolean };
}

export interface ChannelDto {
  id: string;
  platform: 'telegram' | 'bale' | 'rubika';
  channelRef: string;
  title: string;
  status: 'PENDING_VERIFY' | 'ACTIVE' | 'DISABLED' | 'ERROR';
  createdAt: string;
}

export interface BotDto {
  id: string;
  platform: 'telegram' | 'bale' | 'rubika';
  username: string | null;
  title: string;
  status: string;
  mode: 'WEBHOOK' | 'POLLING';
  tokenMasked: string;
  aiEnabled: boolean;
  createdAt: string;
}

export interface PostDto {
  id: string;
  title: string | null;
  body: string;
  state: string;
  source: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  targetSummary?: Record<string, number>;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NotificationDto {
  id: string;
  kind: string;
  titleFa: string;
  bodyFa: string;
  readAt: string | null;
  createdAt: string;
}
