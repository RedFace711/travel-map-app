// Offline support: the app itself is network-first (so updates arrive),
// map libraries and world shapes are cached forever, map tiles are cached as you browse.
const VERSION = 'v2';
const APP = 'app-' + VERSION;
const LIBS = 'libs-v1';
const TILES = 'tiles-v2';
const MAX_TILES = 3000;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => (k.startsWith('app-') && k !== APP) || (k.startsWith('tiles-') && k !== TILES)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    if (name === TILES && Math.random() < 0.05) trimTiles();
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || (await cache.match('index.html'));
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('nominatim')) return; // search always needs the network
  if (url.hostname === 'tile.openstreetmap.org') return e.respondWith(cacheFirst(req, TILES));
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') return e.respondWith(cacheFirst(req, LIBS));
  if (url.origin === self.location.origin) return e.respondWith(networkFirst(req));
});
