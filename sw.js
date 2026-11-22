// Offline support. Serves from cache immediately, refreshes the cache in the background.
// Bump VERSION when you deploy changes so old caches are cleaned up.
const VERSION = 'ev-tracker-v2';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/kpi.js', 'js/fuelio.js', 'js/backup.js', 'js/charts.js', 'js/util.js',
  'js/views/dashboard.js', 'js/views/add.js', 'js/views/history.js', 'js/views/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
