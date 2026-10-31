// Service worker de MichelIA : l'appli s'ouvre même sans réseau, et Michel le dit gentiment.
// Seules les ressources du site sont mises en cache : jamais les appels à Supabase, Google ou Cloudflare.
// v2 : la page d'accueil à « / », le chat à « /chat ».
const VERSION = 'michelia-v2';
const ESSENTIEL = ['/', '/chat', '/hors-ligne.html', '/manifest.webmanifest', '/icones/icone-192.png'];

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
          if (response.ok && (url.pathname === '/' || url.pathname === '/chat')) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(url.pathname, copy));
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

// Notifications push envoyées par la fonction « push » : { title, body, url? }.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'MichelIA', {
      body: message.body || '',
      icon: '/icones/icone-192.png',
      lang: 'fr',
      data: { url: message.url || '/chat' },
    }),
  );
});

// Notification touchée : on revient sur l'onglet déjà ouvert, ou on en ouvre un.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/chat', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Un onglet déjà sur la bonne page est repris tel quel ; sinon, un onglet de Michel (l'accueil, par
      // exemple) est emmené à la bonne page ; sinon on en ouvre un.
      const memeSite = windows.filter((w) => new URL(w.url).origin === self.location.origin);
      const deja = memeSite.find((w) => new URL(w.url).pathname === new URL(url).pathname);
      if (deja) return deja.focus();
      const autre = memeSite.find((w) => 'navigate' in w);
      // navigate() refuse un onglet que ce service worker ne contrôle pas : on en ouvre un autre.
      if (autre) return autre.navigate(url).then((w) => (w || autre).focus(), () => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
