// ════════════════════════════════════════════════════════════════
// xAPEX.AI Service Worker
// Минимален SW — само за PWA installability (без agressive caching).
// Network-first стратегия: винаги тегли свежи данни от Supabase,
// fallback на cache само при offline.
// ════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'xapex-v1';
const CORE_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: cache-ваме core файловете
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(CORE_CACHE).catch(function(){});
    })
  );
  self.skipWaiting();
});

// Activate: чистим стари cache-ове
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_VERSION; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first, cache fallback
self.addEventListener('fetch', function(event) {
  const req = event.request;

  // НИКОГА не интерцептираме Supabase/external API заявки
  // (за да не нарушим cloud sync, training, public table publish)
  if (req.url.includes('supabase.co') ||
      req.url.includes('api.') ||
      req.url.includes('cdn.') ||
      req.method !== 'GET') {
    return;  // browser handles нормално
  }

  // Network-first за HTML/JS/CSS
  event.respondWith(
    fetch(req)
      .then(function(resp) {
        // Cache-ваме успешен response за бъдещ offline access
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(req, clone).catch(function(){});
          });
        }
        return resp;
      })
      .catch(function() {
        // Offline → cache fallback
        return caches.match(req).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
  );
});
