const CACHE_NAME = 'savech-v2.3.0-human-ai';
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
  './manifest.json'
];

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

// Fetch: Stale-While-Revalidate for ultra-fast startup (zero-freeze)
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip browser extensions and external non-essential origins
  if (url.origin !== self.location.origin && !url.hostname.includes('cdn')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. If we have a cached response, return it immediately (<10ms instant load)
      // and revalidate/update the cache in the background
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        // Return instantly, do background fetch
        return cachedResponse;
      }

      // 2. If not in cache, fetch with quick 2-second timeout protection
      return Promise.race([
        fetchPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 2500))
      ]).then((netRes) => {
        if (netRes) return netRes;
        // Fallback for HTML documents
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
        return caches.match(event.request);
      }).catch(() => {
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
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
