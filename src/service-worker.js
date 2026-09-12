const CACHE_NAME = 'media-finder-cache-v4';
const APP_SHELL = [
  './',
  './index.html',
  './app.js?v=4',
  './styles.css',
  './icon.png',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = APP_SHELL.map(url => new Request(url, {cache: 'reload'}));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const obsoleteCaches = cacheNames.filter(name => name !== CACHE_NAME);
    await Promise.all(obsoleteCaches.map(name => caches.delete(name)));
    await self.clients.claim();

    // Existing v2/v3 clients loaded a cached app.js containing the old public
    // proxy fallbacks. Reload them once when this upgrade takes control.
    if (obsoleteCaches.length > 0) {
      const clients = await self.clients.matchAll({type: 'window'});
      await Promise.allSettled(clients.map(client => client.navigate(client.url)));
    }
  })());
});

const networkFirst = async request => {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
};

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const isMutableAppResource = request.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/app.js');

  if (isMutableAppResource) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
