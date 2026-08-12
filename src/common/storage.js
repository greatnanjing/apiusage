import storage from '@system.storage'

const STORE_KEY = 'providers_config'
const SNAPSHOT_KEY = 'last_snapshot'

// 保存供应商配置列表
export function saveProviders(providers) {
  return new Promise((resolve, reject) => {
    storage.set({
      key: STORE_KEY,
      value: JSON.stringify(providers),
      success: resolve,
      fail: function (err, code) { reject(err || code) }
    })
  })
}

// 读取供应商配置列表
export function loadProviders() {
  return new Promise((resolve) => {
    storage.get({
      key: STORE_KEY,
      success: function (resp) {
        try {
          const data = JSON.parse(resp.data)
          resolve(data || [])
        } catch (e) {
          resolve([])
        }
      },
      fail: function () {
        resolve([])
      }
    })
  })
}

// 保存最近一次查询快照
export function saveSnapshot(snapshot) {
  return new Promise((resolve) => {
    storage.set({
      key: SNAPSHOT_KEY,
      value: JSON.stringify({
        timestamp: Date.now(),
        results: snapshot
      }),
      success: resolve,
      fail: resolve
    })
  })
}

// 读取上次快照
export function loadSnapshot() {
  return new Promise((resolve) => {
    storage.get({
      key: SNAPSHOT_KEY,
      success: function (resp) {
        try {
          const data = JSON.parse(resp.data)
          resolve(data || { timestamp: 0, results: [] })
        } catch (e) {
          resolve({ timestamp: 0, results: [] })
        }
      },
      fail: function () {
        resolve({ timestamp: 0, results: [] })
      }
    })
  })
}
