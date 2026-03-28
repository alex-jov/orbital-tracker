const CACHE_NAME = 'orbital-tracker-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/src/main.js',
  '/src/globe.js',
  '/src/satellites.js',
  '/src/ui.js',
  '/src/utils.js',
  '/src/worker.js',
  '/manifest.json',
  '/assets/favicon.svg',
  '/assets/space_bg.jpg',
  '/assets/earth_textures/earth_daymap.jpg',
  '/assets/earth_textures/earth_nightmap.jpg',
  '/assets/earth_textures/earth_topology.png',
  '/assets/earth_textures/earth_water.png',
];

// CDN assets to cache on first fetch
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW: failed to cache some static assets', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // TLE data: network-first with cache fallback
  if (url.includes('celestrak.org')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CDN assets: cache-first
  if (CDN_ASSETS.some((a) => url.includes(a.split('//')[1]))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Static assets: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
