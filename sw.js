// Minimale service worker voor PronoPro.
// Cachet enkel de eigen pagina (het "app shell"), nooit Supabase-data: wedstrijden,
// klassementen en voorspellingen worden altijd rechtstreeks van het netwerk gehaald
// zodat je nooit verouderde scores of standen ziet.

const CACHE_NAME = 'pronopro-cache-v1';
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Enkel bestanden van dezelfde origin (de pagina zelf) cachen. Alles van Supabase,
  // Tailwind CDN, enz. gaat altijd rechtstreeks over het netwerk.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
          .catch(() => cached)
      );
    })
  );
});
