/* Service Worker - 工时记录 PWA (动态版本，从 version.json 读取) */
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

let currentCacheName = 'worktime-default';

self.addEventListener('install', function (event) {
  event.waitUntil(
    fetch('version.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var ver = data.version || '1.0.0';
        currentCacheName = 'worktime-' + ver;
        return caches.open(currentCacheName)
          .then(function (cache) { return cache.addAll(ASSETS); })
          .then(function () { return self.skipWaiting(); });
      })
      .catch(function () {
        // 降级：取不到版本号时使用默认缓存名
        currentCacheName = 'worktime-default';
        return caches.open(currentCacheName)
          .then(function (cache) { return cache.addAll(ASSETS); })
          .then(function () { return self.skipWaiting(); });
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          return k !== currentCacheName && k.startsWith('worktime-');
        }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.search) return; // 带参数的请求透传，不缓存

  if (req.mode === 'navigate') {
    // 导航请求：网络优先，失败时兜底 index.html
    event.respondWith(
      fetch(req).catch(function () {
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
          caches.open(currentCacheName).then(function (cache) {
            cache.put(req, clone);
          });
        }
        return response;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
