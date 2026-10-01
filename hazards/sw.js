// 极简离线壳缓存：缓存应用外壳；数据快照仍由 OfflineCache 管理并带 TTL 与“已过期”标注。
// 本文件不会改变数据新鲜度语义——过期快照在 UI 中依然明确告警。
const CACHE = 'manxing-hazards-shell-v1';
const SHELL = [
  '/hazards.html',
  '/hazards/css/hazards.css',
  '/hazards/src/model.js',
  '/hazards/src/geometry.js',
  '/hazards/src/association.js',
  '/hazards/src/route.js',
  '/hazards/src/advisory.js',
  '/hazards/src/cache.js',
  '/hazards/src/view.js',
  '/hazards/src/ui.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('/hazards.html'))),
  );
});
