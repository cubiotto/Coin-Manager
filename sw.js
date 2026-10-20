// Cho phép app mở được khi không có mạng. Trả bản đã lưu ngay, đồng thời tải bản mới
// ở nền để lần mở sau dùng (cập nhật code trên GitHub Pages sẽ tự tới máy).
//
// Mọi trang *.github.io của cùng một tài khoản dùng chung kho cache — chỉ đụng tới cache có tiền tố của app này.
const PREFIX = 'coin-manager-';
const CACHE = `${PREFIX}v15`;
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/parser.js', './js/categories.js', './js/db.js', './js/store.js', './js/vault.js',
  './js/voice.js', './js/charts.js', './js/format.js', './js/sync.js', './js/gdrive.js', './js/oauth.js', './oauth.html', './js/datepicker.js', './js/recurring.js', './js/sheets.js', './js/wallets.js', './js/assets.js', './js/strips.js', './js/refunds.js', './js/discounts.js', './config/google.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/duck.svg', './icons/duck-peek.svg',
  './fonts/nunito-latin.woff2', './fonts/nunito-latin-ext.woff2', './fonts/nunito-vietnamese.woff2',
];

self.addEventListener('install', e => {
  // cache: 'reload' — lấy thẳng từ server, không dùng bản cũ trong HTTP cache của trình duyệt
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    // no-cache: luôn hỏi lại server (ETag → 304 nếu chưa đổi), tránh lấy bản cũ trong HTTP cache của trình duyệt
    const network = fetch(e.request.url, { cache: 'no-cache' })
      .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cached);
    if (cached) {
      e.waitUntil(network);
      return cached;
    }
    return network;
  }));
});
