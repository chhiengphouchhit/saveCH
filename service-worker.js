const CACHE_NAME = 'savech-v2.10.2-network-first-auto-update';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/middleware.js',
  './js/supabaseClient.js',
  './js/audio.js',
  './assets/profile.jpg',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './manifest.json'
];

// Explicit message listener to force skipWaiting and purge caches on demand
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'PURGE_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});

// Install: Pre-cache essential app shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch((err) => {
      console.warn('SW pre-cache warning:', err);
    })
  );
});

// Activate: Immediately claim clients and purge old caches (including pocketai)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-First for Navigation (HTML) & Versioned Assets; Stale-While-Revalidate for static assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip external origins except cdn
  if (url.origin !== self.location.origin && !url.hostname.includes('cdn')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
  const hasCacheBuster = url.searchParams.has('v') || url.searchParams.has('updated') || url.searchParams.has('t');

  // Network-First for HTML navigation and versioned requests
  if (isNavigation || hasCacheBuster) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (isNavigation) {
            return (await caches.match('./index.html')) || (await caches.match('./'));
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Stale-While-Revalidate for images, icons, and static styling
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});

// Background Sync handler
self.addEventListener('sync', (event) => {
  if (event.tag === 'savech-sync-transactions' || event.tag === 'pocketai-sync-transactions') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_BACKGROUND_SYNC' });
        });
      })
    );
  }
});
