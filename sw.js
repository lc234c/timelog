/* Service Worker - 工时记录 PWA v1.7.3
   策略：缓存优先（Cache First）仅作用于同源静态资源预缓存清单；
   导航(navigate)请求优先走网络、离线时兜底 index.html，保证 SPA 路由可用；
   非 GET / 带 query 的动态请求透传，不写入缓存，避免干扰下载/分享等动态行为。 */
const CACHE_NAME = 'worktime-v1.7.3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
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
  if (url.origin !== self.location.origin) return;
  if (url.search) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) { return res; }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

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
