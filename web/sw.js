var CACHE_NAME = 'apiusage-v2'

self.addEventListener('install', function(e) {
  self.skipWaiting()
})

self.addEventListener('activate', function(e) {
  // 清理旧缓存（v1 会把 API 响应也缓存掉，导致余额不再更新）
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return k !== CACHE_NAME
      }).map(function(k) {
        return caches.delete(k)
      }))
    }).then(function() {
      return clients.claim()
    })
  )
})

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url)
  // API 请求与跨域请求一律不缓存，保证余额实时查询
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) {
    return
  }
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
