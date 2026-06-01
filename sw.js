// Workers PWA — Service Worker
// Strategy:
//   - Page shells & static assets: cache-first (fast offline loads)
//   - API calls (/api/*): network-only (never cache dynamic data)
//   - Supabase: network-only

const CACHE = 'workers-v1';

const PRECACHE = [
  '/',
  '/finance',
  '/po-coach',
  '/work',
  '/shared/shared.css',
  '/shared/config.js',
  '/shared/utils.js',
  '/shared/nav.js',
  '/manifest.json',
  '/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API calls or Supabase
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Only cache successful same-origin responses
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      });
    })
  );
});
