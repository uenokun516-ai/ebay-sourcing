// 最小限のオフラインキャッシュ：同一オリジンのGETを「ネット優先・失敗時キャッシュ」で返す。
const CACHE = 'ebay-sourcing-v1';
self.addEventListener('install', (e) => {
  // index.html が参照する JS/CSS も最初にまとめてキャッシュする（初回表示の読み込みは SW 登録前のため）
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(['./', './index.html', './manifest.webmanifest']);
    const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await c.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html', { ignoreVary: true }) : Response.error()))),
  );
});
