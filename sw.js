const CACHE_NAME = 'hlc-cache-v1';
const SCOPE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const CORE_ASSETS = [
  `${SCOPE}/public/index.html`,
  `${SCOPE}/src/styles/variables.css`,
  `${SCOPE}/src/styles/base.css`,
  `${SCOPE}/src/styles/theme.css`,
  `${SCOPE}/src/styles/components.css`,
  `${SCOPE}/src/js/app.js`,
  `${SCOPE}/src/js/api.js`,
  `${SCOPE}/src/js/storage.js`,
  // Removed nonexistent worker path; OCR loads via CDN
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, net.clone());
        return net;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return cache.match(`${SCOPE}/public/index.html`) || cache.match('/public/index.html');
      }
    })());
    return;
  }

  if (url.origin === location.origin && ['style', 'script', 'image', 'font', 'worker'].includes(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      cache.put(req, net.clone());
      return net;
    })());
    return;
  }
});
