/* NEWGEN CHAT service worker — installable PWA shell */
const CACHE_PREFIX = 'newgen-chat-pwa';
const SHELL_CACHE = CACHE_PREFIX + '-shell-v5';
const ASSET_CACHE = CACHE_PREFIX + '-assets-v5';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== ASSET_CACHE)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept API / auth / realtime
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/v1/') ||
    url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/realtime/') ||
    url.pathname.startsWith('/storage/v1/')
  ) {
    return;
  }

  // App shell for all navigations (required for reliable install + offline open)
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        return (
          (await caches.match('/index.html')) ||
          (await caches.match('/')) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
        );
      }
    })());
    return;
  }

  const isStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    SHELL_URLS.includes(url.pathname);

  if (!isStatic) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
