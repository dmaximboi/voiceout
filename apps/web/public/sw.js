const SHELL = 'voiceout-shell-v3';
const MEDIA = 'voiceout-media-v1';
const SHELL_URLS = ['/', '/manifest.json', '/logo.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isMedia =
    !req.headers.has('range') &&
    (url.pathname.includes('/vo-api/media/') && url.pathname.endsWith('/file') || url.pathname.startsWith('/samples/'));

  if (isMedia) {
    event.respondWith(
      caches.open(MEDIA).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/vo-api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith('/_next/static/') || SHELL_URLS.includes(url.pathname))) {
          caches.open(SHELL).then((cache) => cache.put(req, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  );
});
