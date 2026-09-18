/**
 * HTTP kernel: timeout-bounded fetch + SSRF guard for outbound provider calls.
 */
import { lookup } from 'node:dns/promises';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Global fetch with a hard timeout via AbortSignal.timeout (respects caller-provided signal). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

/* ----------------------------- SSRF guard ----------------------------- */

const V4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local incl. metadata 169.254.169.254)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
];

function v4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const v = v4ToUint32(ip);
  if (v === null) return false;
  return V4_RANGES.some(([lo, hi]) => v >= lo && v <= hi);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const addr = ip.split('%')[0] ?? ip; // strip zone id
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ?? '';
  const tail = halves.length === 2 ? (halves[1] ?? '') : null;

  const parseGroups = (part: string): bigint[] | null => {
    if (part === '') return [];
    const groups: bigint[] = [];
    const items = part.split(':');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) return null;
      // Embedded IPv4 (e.g. ::ffff:10.0.0.1) — allowed only as the last group.
      if (item.includes('.')) {
        if (i !== items.length - 1) return null;
        const v4 = v4ToUint32(item);
        if (v4 === null) return null;
        groups.push(BigInt(v4 >>> 16));
        groups.push(BigInt(v4 & 0xffff));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null;
        groups.push(BigInt(parseInt(item, 16)));
      }
    }
    return groups;
  };

  const headGroups = parseGroups(head);
  if (headGroups === null) return null;
  const tailGroups = tail === null ? [] : parseGroups(tail);
  if (tailGroups === null) return null;

  const fill = tail === null ? [] : Array.from({ length: 8 - headGroups.length - tailGroups.length }, () => 0n);
  if (tail !== null && 8 - headGroups.length - tailGroups.length < 0) return null;
  const groups = [...headGroups, ...fill, ...tailGroups];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) value = (value << 16n) | g;
  return value;
}

function isPrivateV6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  if (value === null) return false;
  if (value === 0n) return true; // :: unspecified
  if (value === 1n) return true; // ::1 loopback
  const top16 = value >> 112n;
  // fc00::/7 (unique local: fc00–fdff)
  if (top16 >= 0xfc00n && top16 <= 0xfdffn) return true;
  // fe80::/10 (link-local: fe80–febf)
  if (top16 >= 0xfe80n && top16 <= 0xfebfn) return true;
  // IPv4-mapped ::ffff:0:0/96 — evaluate embedded IPv4 against the IPv4 ranges.
  if ((value >> 32n) === 0xffffn) {
    const v4 = Number(value & 0xffffffffn) >>> 0;
    return V4_RANGES.some(([lo, hi]) => v4 >= lo && v4 <= hi);
  }
  return false;
}

/** True when the IP falls in a private/reserved/non-routable range (incl. metadata IPs). */
export function isPrivateIp(ip: string): boolean {
  const host = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) return isPrivateV6(host);
  return isPrivateV4(host);
}

function isIpLiteral(host: string): boolean {
  return host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Validate that a URL targets a public host: http/https only, no localhost,
 * no private/reserved IP literals, and DNS resolution must not resolve into
 * a private range. Returns the parsed URL; throws with a reason otherwise.
 */
export async function assertSafePublicUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('SSRF_BLOCKED: invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`SSRF_BLOCKED: protocol not allowed (${url.protocol})`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('SSRF_BLOCKED: localhost is not allowed');
  }
  if (isPrivateIp(host)) {
    throw new Error('SSRF_BLOCKED: private or reserved address');
  }
  if (!isIpLiteral(host)) {
    let addresses;
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error(`SSRF_BLOCKED: DNS lookup failed for ${host}`);
    }
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        throw new Error('SSRF_BLOCKED: host resolves to a private or reserved address');
      }
    }
  }
  return url;
}
