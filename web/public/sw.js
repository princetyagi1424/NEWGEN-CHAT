const CACHE_PREFIX = 'newgen-chat-pwa';
const SHELL_CACHE = CACHE_PREFIX + '-shell-v1';
const ASSET_CACHE = CACHE_PREFIX + '-assets-v1';
const SHELL_URLS = [
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
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== ASSET_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'PRECACHE_URLS' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const urls = event.data.urls
      .filter(value => typeof value === 'string')
      .map(value => new URL(value, self.location.origin))
      .filter(url => url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
      .map(url => url.href);
    await Promise.all(urls.map(async url => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok && response.type === 'basic') await cache.put(url, response);
      } catch {
        // A failed optional warm-up must not break the installed app.
      }
    }));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated API responses, private messages or signed media.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request) || await caches.match('/index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  const isStaticAsset = url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    SHELL_URLS.includes(url.pathname);

  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
