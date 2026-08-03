const CACHE = 'catalogo-v5';

// index.html NO está en esta lista: siempre debe venir de la red para
// evitar desincronización entre HTML cacheado y JS/CSS nuevos.
const STATIC_ASSETS = ['/style.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API: siempre a la red, sin caché
  if (url.includes('/api/')) return;

  // HTML (index.html / rutas raíz): red primero, caché como fallback offline
  if (e.request.destination === 'document' || url.endsWith('/') || !url.includes('.')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Assets estáticos (CSS, JS, íconos): caché primero, red como fallback
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
