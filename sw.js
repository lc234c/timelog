'use strict';
/*!
 * 工时记录 · Service Worker (PWA)
 * 策略：网络优先（network-first）用于导航请求，缓存优先（cache-first）用于静态资源
 * 版本：2.6.0
 */

var SW_VERSION = 'v2.6.0';
var SW_BUILD = 20260914;
var CACHE_NAME = 'worktime-cache-' + SW_BUILD;
var PRECACHE = [
    './',
    './index.html',
    './style.css',
    './schedule.css',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './version.json',
    './js/01-core.js',
    './js/02-storage.js',
    './js/03-state.js',
    './js/04-calendar.js',
    './js/05-stats.js',
    './js/06-ot-leave.js',
    './js/07-salary.js',
    './js/08-ui.js',
    './js/09-app.js',
    './js/10-schedule.js'
];

/* ============================================================
 * 1. Install：预缓存核心资源
 * ========================================================== */
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            // 逐个添加，失败的资源不阻塞安装
            return Promise.allSettled(
                PRECACHE.map(function (url) {
                    return cache.add(url).catch(function (e) {
                        console.warn('[SW] precache miss:', url, e.message);
                    });
                })
            );
        }).then(function () {
            console.log('[SW] install complete', SW_VERSION);
            return self.skipWaiting();
        })
    );
});

/* ============================================================
 * 2. Activate：清理旧缓存
 * ========================================================== */
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (name) {
                    return name !== CACHE_NAME;
                }).map(function (name) {
                    console.log('[SW] deleting old cache:', name);
                    return caches.delete(name);
                })
            );
        }).then(function () {
            console.log('[SW] activate complete', SW_VERSION);
            return self.clients.claim();
        })
    );
});

/* ============================================================
 * 3. Fetch：网络优先（导航）+ 缓存优先（静态资源）
 * ========================================================== */
self.addEventListener('fetch', function (event) {
    var req = event.request;

    // 只处理 GET 请求
    if (req.method !== 'GET') return;

    // 跳过 chrome-extension 等非 http(s) 协议
    var url = new URL(req.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    // 导航请求（页面）：网络优先，失败回退缓存
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
        event.respondWith(
            fetch(req).then(function (resp) {
                var copy = resp.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(req, copy).catch(function () {});
                });
                return resp;
            }).catch(function () {
                return caches.match(req).then(function (cached) {
                    return cached || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // 静态资源：缓存优先，回退网络
    event.respondWith(
        caches.match(req).then(function (cached) {
            if (cached) {
                // 后台更新缓存（stale-while-revalidate）
                fetch(req).then(function (resp) {
                    if (resp && resp.ok) {
                        caches.open(CACHE_NAME).then(function (cache) {
                            cache.put(req, resp.clone()).catch(function () {});
                        });
                    }
                }).catch(function () {});
                return cached;
            }
            return fetch(req).then(function (resp) {
                if (resp && resp.ok) {
                    var copy = resp.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(req, copy).catch(function () {});
                    });
                }
                return resp;
            }).catch(function () {
                // 离线且无缓存：对图片返回空响应
                return new Response('', { status: 504, statusText: 'Offline' });
            });
        })
    );
});

/* ============================================================
 * 4. Message：处理「清除缓存」指令
 * ========================================================== */
self.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg === 'clearCache') {
        caches.keys().then(function (names) {
            return Promise.all(names.map(function (n) { return caches.delete(n); }));
        }).then(function () {
            console.log('[SW] all caches cleared');
            if (event.source) event.source.postMessage({ type: 'cacheCleared' });
        });
    }
    if (msg === 'skipWaiting') {
        self.skipWaiting();
    }
});
