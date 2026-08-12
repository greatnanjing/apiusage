var CACHE_NAME = 'apiusage-v3'

self.addEventListener('install', function(e) {
  // 立即激活，不必等旧 SW 释放
  self.skipWaiting()
})

self.addEventListener('activate', function(e) {
  // 清理旧缓存（v1/v2 会把 index.html 也缓存住，导致用户拿不到新版）
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return k !== CACHE_NAME
      }).map(function(k) {
        return caches.delete(k)
      }))
    }).then(function() {
      return self.clients.claim()
    })
  )
})

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url)
  // 非 GET、跨域、API 请求一律不缓存，保证余额实时查询
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) {
    return
  }

  // HTML 导航请求：network-first，确保用户每次刷新都拿到最新版页面，
  // 只有离线时才回退到缓存。避免 cache-first 把旧 HTML 卡死。
  var accept = e.request.headers.get('accept') || ''
  if (e.request.mode === 'navigate' || accept.indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        if (resp.ok) {
          var clone = resp.clone()
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone) })
        }
        return resp
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || new Response('离线：请检查网络', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        })
      })
    )
    return
  }

  // 其他静态资源（图标等）：cache-first，提速
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        if (resp.ok) {
          var clone = resp.clone()
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone) })
        }
        return resp
      })
    })
  )
})
