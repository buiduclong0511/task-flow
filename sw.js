const CACHE_NAME = 'taskflow-v1.4.0';
const ASSETS = [
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/style.css',
  '/app.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Syne:wght@400;600;700;800&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network first for HTML pages and Firebase APIs
  if (e.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.js')
    || e.request.url.includes('firebaseio')
    || e.request.url.includes('googleapis.com/identitytoolkit')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache first for static assets (images, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
