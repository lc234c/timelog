/* Service Worker - 工时记录 PWA v1.7.3
   策略：缓存优先（Cache First）仅作用于同源静态资源预缓存清单；
   导航(navigate)请求优先走网络、离线时兜底 index.html，保证 SPA 路由可用；
   非 GET / 带 query 的动态请求透传，不写入缓存，避免干扰下载/分享等动态行为。
   v1.7.3：script.js 已按职责拆分为 storage.js / chart.js / ui.js 三个模块。 */
const CACHE_NAME = 'worktime-v1.7.3';
const ASSETS = [
  './',
  './style.css',
  './storage.js',
  './chart.js',
  './ui.js',
  './manifest.json',
  './changelog.json',
  './version.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // 非 GET 透传，不拦截
  var url = new URL(req.url);
  // 仅处理同源请求；跨域（如 CDN/统计）透传
  if (url.origin !== self.location.origin) return;
  // 带 query 的动态请求（如带参数的 API/下载派生）透传，不缓存
  if (url.search) return;

  if (req.mode === 'navigate') {
    // 导航：网络优先，失败兜底 index.html（SPA 离线可用）
    event.respondWith(
      fetch(req).then(function (res) { return res; }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
        }
        return response;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
