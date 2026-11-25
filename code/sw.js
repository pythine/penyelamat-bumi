/* sw.js — cache supaya buka pertama = unduh, buka berikutnya = langsung tampil dari cache,
   dan jika file di server berubah, versi baru otomatis diambil di latar belakang lalu halaman dimuat ulang.
   Tidak perlu mengubah nomor versi saat mengganti index.html / rooms.html (perubahan isi dideteksi sendiri).
   Naikkan V hanya jika kamu mengubah logika sw.js ini, supaya cache lama dibuang. */
const V = 'v1';
const SHELL = 'vgr-shell-' + V, RUNTIME = 'vgr-run-' + V, IMG = 'vgr-img-' + V;
/* Path relatif = relatif terhadap lokasi sw.js ini (taruh sw.js di folder yang sama dengan index.html, mis. code/). */
const PRECACHE = ['./', 'index.html', 'rooms.html', 'manifest.json', 'icon-192.png'];
const DOCS = ['./', 'rooms.html'];            /* dicek berkala untuk versi baru */
const abs = p => new URL(p, self.location).href;

/* '/' dan '/index.html' memakai satu kunci; query (?mode=..&id=..) diabaikan agar rooms.html selalu kena cache */
function keyOf(u) {
  const x = new URL(u, self.location); let p = x.pathname;
  if (p.endsWith('/')) p += 'index.html';
  return x.origin + p;
}
const isText = res => /text\/|json|javascript|xml/i.test(res.headers.get('content-type') || '');

async function broadcast(path) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  all.forEach(c => c.postMessage({ type: 'SW_UPDATED', path }));
}

/* Ambil dari jaringan (selalu validasi ke server), simpan, dan beri tahu halaman jika isinya berbeda dari cache */
async function revalidate(url, key, notify) {
  const cache = await caches.open(SHELL);
  const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res || !res.ok || res.status === 206) return res;
  let changed = false;
  if (notify && isText(res)) {
    const old = await cache.match(key);
    if (old) changed = (await res.clone().text()) !== (await old.text());
  }
  await cache.put(key, res.clone());
  if (changed) await broadcast(new URL(key).pathname);
  return res;
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(PRECACHE.map(u => fetch(abs(u), { cache: 'reload' }).then(r => r.ok && c.put(keyOf(abs(u)), r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME, IMG]);
    await Promise.all((await caches.keys()).filter(k => k.startsWith('vgr-') && !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const ks = await cache.keys();
  if (ks.length > max) await Promise.all(ks.slice(0, ks.length - max).map(k => cache.delete(k)));
}

/* Halaman milik sendiri: tampil dari cache seketika, lalu cek versi baru di latar belakang */
async function appShell(e) {
  const req = e.request, key = keyOf(req.url), cache = await caches.open(SHELL), hit = await cache.match(key);
  const upd = revalidate(req.url, key, true);
  if (hit) { e.waitUntil(upd.catch(() => {})); return hit }
  try { return await upd } catch {
    return (await cache.match(keyOf(abs('index.html')))) || Response.error(); /* offline & belum ada cache */
  }
}
/* Berkas statis lain (CDN: tailwind, supabase-js, font): dari cache dulu, diperbarui diam-diam */
async function swr(e) {
  const req = e.request, cache = await caches.open(RUNTIME), hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque') && res.status !== 206) cache.put(req, res.clone()); return res });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit }
  try { return await net } catch { return Response.error() }
}
/* Foto (avatar/postingan di Supabase Storage): nama berkas unik, jadi cukup cache-first */
async function images(e) {
  const req = e.request, cache = await caches.open(IMG), hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    let res; try { res = await fetch(req.url, { mode: 'cors' }) } catch { res = await fetch(req) }
    if (res && (res.ok || res.type === 'opaque') && res.status !== 206) { await cache.put(req.url, res.clone()); e.waitUntil(trim(cache, 300)) }
    return res;
  } catch { return Response.error() }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    if (req.mode === 'navigate' || /\.html?$/i.test(url.pathname) || url.pathname.endsWith('/')) return e.respondWith(appShell(e));
    return e.respondWith(swr(e));
  }
  if (url.hostname.endsWith('.supabase.co')) {
    if (/\/storage\/v1\/object\/public\/.+\.(jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) return e.respondWith(images(e));
    return; /* API, realtime, video, audio: langsung ke jaringan */
  }
  e.respondWith(swr(e));
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'CHECK') {
    e.waitUntil(Promise.all(DOCS.map(u => revalidate(abs(u), keyOf(abs(u)), true).catch(() => {}))));
  } else if (d.type === 'WARM' && Array.isArray(d.urls)) { /* halaman menitipkan daftar berkas yang baru dimuat agar kunjungan kedua pun sudah ngebut */
    e.waitUntil((async () => {
      const cache = await caches.open(RUNTIME);
      for (const u of d.urls.slice(0, 60)) {
        try {
          const x = new URL(u); if (!/^https?:$/.test(x.protocol) || x.hostname.endsWith('.supabase.co') || x.origin === self.location.origin) continue;
          if (await cache.match(u)) continue;
          let res; try { res = await fetch(u, { mode: 'cors' }) } catch { res = await fetch(u, { mode: 'no-cors' }) }
          if (res && (res.ok || res.type === 'opaque')) await cache.put(u, res);
        } catch {}
      }
    })());
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});