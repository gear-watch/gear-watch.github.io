// GearWatch photo helper. Photos are private: this adds your sign-in to photo requests so the browser can show them.
const PUB = '/storage/v1/object/public/photos/', AUTHD = '/storage/v1/object/authenticated/photos/';
const KEY = 'https://gearwatch.local/auth', PHOTOS = 'gw-photos', META = 'gw-auth';
let mem = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'gw-auth') return;
  mem = { token: d.token || null, key: d.key || '' };
  e.waitUntil((async () => {
    const c = await caches.open(META); await c.put(KEY, new Response(JSON.stringify(mem)));
    if (!mem.token && d.wipe) await caches.delete(PHOTOS);
  })());
});

async function auth() {
  if (mem) return mem;
  try { const r = await (await caches.open(META)).match(KEY); mem = r ? await r.json() : { token: null }; } catch (e) { mem = { token: null }; }
  return mem;
}

self.addEventListener('fetch', e => {
  const req = e.request, u = req.url, i = u.indexOf(PUB);
  if (req.method !== 'GET' || i < 0) return;
  e.respondWith((async () => {
    const key = u.split('?')[0], cache = await caches.open(PHOTOS);
    const hit = await cache.match(key); if (hit) return hit;
    const a = await auth();
    if (a.token) {
      try {
        const r = await fetch(u.slice(0, i) + AUTHD + key.slice(i + PUB.length), { mode: 'cors', credentials: 'omit', headers: { Authorization: 'Bearer ' + a.token, apikey: a.key } });
        if (r.ok) { cache.put(key, r.clone()).catch(() => {}); return r; }
      } catch (err) {}
    }
    return fetch(req);
  })());
});
