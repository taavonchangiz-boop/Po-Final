import { request, Agent } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError, ERR } from './errors.js';

/**
 * Hardened outbound HTTP (§60, §110): explicit timeout, SSRF guard for
 * user-influenced URLs, bounded response size, no unbounded redirects.
 */
const agent = new Agent({ connections: 32, pipelining: 1 });
const MAX_REDIRECTS = 3;

export interface HttpResult {
  status: number;
  body: string;
  contentType: string;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    // IPv4-mapped
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateIp(mapped[1]);
    return false;
  }
  if (isIP(ip) !== 4) return true; // unknown families are treated as unsafe
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

const BLOCKED_HOST_SUFFIXES = [
  'metadata.google.internal',
  'metadata.goog',
];

/** Validate a user-influenced URL against SSRF (scheme, host, DNS, ranges). */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(ERR.VALIDATION('آدرس واردشده معتبر نیست.'));
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(ERR.VALIDATION('فقط آدرس‌های http و https مجاز هستند.'));
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
  } else {
    try {
      const records = await lookup(host, { all: true, verbatim: true });
      if (records.length === 0) throw new Error('no records');
      for (const r of records) {
        if (isPrivateIp(r.address)) throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(ERR.VALIDATION('میزبان آدرس قابل‌شناسایی نیست.'));
    }
  }
  return url;
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: string;
  /** When false, skips SSRF guard — only for fixed, code-controlled provider endpoints. */
  ssrfGuard?: boolean;
}

export async function httpJson<T>(
  url: string,
  options: HttpOptions = {}
): Promise<{ status: number; data: T }> {
  const res = await httpRaw(url, options);
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new AppError(ERR.PROVIDER_UNAVAILABLE());
  }
  return { status: res.status, data: data as T };
}

export async function httpRaw(url: string, options: HttpOptions = {}): Promise<HttpResult> {
  const {
    timeoutMs = 15_000,
    headers = {},
    method = 'GET',
    body,
    ssrfGuard = false,
  } = options;

  let currentUrl = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const guardUrl = ssrfGuard ? await assertSafeUrl(currentUrl) : undefined;
    const res = await request(currentUrl, {
      method,
      headers: { 'user-agent': 'Postyar/1.0 (+https://postyar.ir)', ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: agent,
      ...(guardUrl ? { servername: guardUrl.hostname } : {}),
    });

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      res.body.dump();
      if (typeof location === 'string' && redirects < MAX_REDIRECTS) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      return { status: res.statusCode, body: '', contentType: '' };
    }

    const text = await res.body.text();
    return {
      status: res.statusCode,
      body: text.length > 2_000_000 ? text.slice(0, 2_000_000) : text,
      contentType: String(res.headers['content-type'] ?? ''),
    };
  }
  throw new AppError(ERR.PROVIDER_UNAVAILABLE());
}
