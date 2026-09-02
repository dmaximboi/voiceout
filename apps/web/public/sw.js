const SHELL = 'voiceout-shell-v6';
const STATIC = 'voiceout-static-v6';
const MEDIA = 'voiceout-media-v4';
const SHELL_URLS = ['/', '/manifest.json', '/logo.png', '/icon-192.png', '/icon-512.png', '/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, STATIC, MEDIA]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PULL_FEED') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: 'FEED_PULL' });
      }),
    );
  }
  if (event.data?.type === 'PREFETCH' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(SHELL).then(async (cache) => {
        for (const url of event.data.urls.slice(0, 12)) {
          try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* ignore */
          }
        }
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache /vo-api or /auth — media can be owner-only; auth must stay live.
  if (url.pathname.startsWith('/vo-api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  if (url.pathname.startsWith('/samples/')) {
    event.respondWith(cacheFirst(MEDIA, req));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(STATIC, req));
    return;
  }

  // HTML — network first, no write-back of navigations (avoids stale blank shells).
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/') || caches.match('/offline')),
        ),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL_URLS.includes(url.pathname)) {
          void caches.open(SHELL).then((cache) => cache.put(req, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  );
});

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) {
    void fetch(req)
      .then((res) => {
        if (res.ok) void cache.put(req, res.clone());
      })
      .catch(() => undefined);
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) void cache.put(req, res.clone());
  return res;
}
