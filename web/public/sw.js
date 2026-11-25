const CACHE_PREFIX = 'newgen-chat-pwa';
const SHELL_CACHE = CACHE_PREFIX + '-shell-v3';
const ASSET_CACHE = CACHE_PREFIX + '-assets-v3';
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
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== ASSET_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
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
        // Optional warm-up must not break the installed app.
      }
    }));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API or auth traffic.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/v1/') ||
    url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/realtime/')
  ) {
    return;
  }

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
        const cached = await caches.match('/index.html') || await caches.match('/');
        return cached || new Response('Offline. Open the site once while online.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  const isStaticAsset = url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    SHELL_URLS.includes(url.pathname);

  if (!isStaticAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      return cached || Response.error();
    }
  })());
});
