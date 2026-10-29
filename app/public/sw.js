// Service worker de MichelIA : l'appli s'ouvre même sans réseau, et Michel le dit gentiment.
// Seules les ressources du site sont mises en cache : jamais les appels à Supabase, Google ou Cloudflare.
const VERSION = 'michelia-v1';
const ESSENTIEL = ['/', '/hors-ligne.html', '/manifest.webmanifest', '/icones/icone-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ESSENTIEL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/captcha' || url.pathname.startsWith('/captcha.')) return;

  // Pages : le réseau d'abord pour toujours avoir la dernière version, le cache si ça ne capte pas.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || caches.match('/hors-ligne.html')),
    );
    return;
  }

  // Scripts et images versionnés : le cache d'abord, ils ne changent jamais sous le même nom.
  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Le reste (icônes, pages légales) : le cache tout de suite, mis à jour en douce.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
