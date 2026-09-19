/*
 * Postyar service worker — conservative offline shell cache.
 *
 * Strategy:
 * - Non-GET requests are never touched (always pass through to the network).
 * - /api and /health traffic is never intercepted or cached.
 * - Navigations: network-first; cached shell ('/index.html') on failure.
 * - Same-origin /assets/* (content-hashed filenames): cache-first.
 * - Other same-origin GETs: network-first with a cache fallback.
 *
 * The worker is intentionally defensive: every cache read/write is wrapped so
 * a broken or unavailable Cache API can never crash a page.
 */

const VERSION = 'postyar-v1';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

/** App shell entries precached during install (absolute paths). */
const SHELL_ASSETS = ['/', '/manifest.webmanifest'];

/** Install: precache the shell, then take over immediately. */
self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

/** Activate: remove caches from older versions, then claim clients. */
self.addEventListener('activate', (event) => {
  event.waitUntil(cleanupOldCaches());
});

/**
 * Fetch: apply the routing rules above. The handler returns early (never
 * calls respondWith) for anything that must pass through untouched.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Rule 1: never touch non-GET requests.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // Rule 2: never intercept API/health traffic (and the worker script itself).
  if (isBypassPath(url.pathname)) return;

  // Rule 3: only manage same-origin requests; cross-origin passes through
  // (no caching of cross-origin or opaque responses).
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(request));
    return;
  }

  event.respondWith(handleOther(request));
});

/** True for paths that must always reach the network untouched. */
function isBypassPath(pathname) {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/health' ||
    pathname.startsWith('/health/') ||
    pathname === '/sw.js'
  );
}

/** Install helper: precache shell entries, swallowing per-entry failures. */
async function precacheShell() {
  const base =
    self.registration && self.registration.scope ? self.registration.scope : '/';
  await Promise.all(
    SHELL_ASSETS.map(async (path) => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        const url = new URL(path, base);
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (_) {
        // Offline during install: skip this entry; the fetch handler fills
        // the shell cache on the next successful navigation.
      }
    })
  );
}

/** Activate helper: delete caches belonging to older versions. */
async function cleanupOldCaches() {
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  } catch (_) {
    // Activation cleanup is best-effort only.
  }
}

/** Navigations: network-first, cached shell as offline fallback. */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      // Store a clone under the navigation URL for later offline visits.
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, fresh.clone());
      } catch (_) {
        // Quota or storage errors must not break the response.
      }
    }
    return fresh;
  } catch (_) {
    const cached =
      (await matchAnyCache(request)) ||
      (await matchAnyCache('/index.html')) ||
      (await matchAnyCache('/'));
    if (cached) return cached;
    return offlineResponse();
  }
}

/** Content-hashed static assets: cache-first, fill cache on miss. */
async function handleAsset(request) {
  const cached = await matchAnyCache(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      try {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, fresh.clone());
      } catch (_) {
        // Quota or storage errors must not break the response.
      }
    }
    return fresh;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** Everything else same-origin: network-first with cache fallback. */
async function handleOther(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      try {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, fresh.clone());
      } catch (_) {
        // Quota or storage errors must not break the response.
      }
    }
    return fresh;
  } catch (_) {
    const cached = await matchAnyCache(request);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** Read from any cache, defensively (never throws). */
async function matchAnyCache(resource) {
  try {
    return await caches.match(resource);
  } catch (_) {
    return undefined;
  }
}

/** Minimal RTL fallback page shown only when no cached shell exists. */
function offlineResponse() {
  const html =
    '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>پُست‌یار — آفلاین</title></head>' +
    '<body style="margin:0;font-family:system-ui,sans-serif;text-align:center;padding:3rem 1rem;color:#1e293b">' +
    '<p style="font-size:1.1rem">اتصال اینترنت در دسترس نیست.</p>' +
    '<p style="color:#64748b">لطفاً پس از برقراری اتصال دوباره تلاش کنید.</p>' +
    '</body></html>';
  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
