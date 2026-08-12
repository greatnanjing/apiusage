import fetch from '@system.fetch'

// 默认超时 10 秒
const DEFAULT_TIMEOUT = 10000

/**
 * 根据供应商配置发起 HTTP 请求
 * @param {Object} provider - 供应商配置对象
 * @returns {Promise<Object>} 解析后的余额数据
 */
export function queryBalance(provider) {
  return new Promise((resolve, reject) => {
    // 鉴权头
    let authValue = ''
    if (provider.authType === 'bearer') {
      authValue = 'Bearer ' + provider.apiKey
    } else if (provider.authType === 'hmac') {
      authValue = buildHmacAuth(provider)
    }

    const headers = {}
    headers[getAuthHeaderName(provider)] = authValue
    headers['Accept'] = 'application/json'

    fetch.fetch({
      url: provider.endpoint,
      method: provider.method || 'GET',
      header: headers,
      responseType: 'json',
      timeout: DEFAULT_TIMEOUT,
      success: function (resp) {
        try {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data
          resolve({ providerId: provider.id, data, provider })
        } catch (e) {
          reject({ providerId: provider.id, error: 'parse_error', message: '响应解析失败' })
        }
      },
      fail: function (err, code) {
        let message = '请求失败'
        if (code === 401 || code === 403) {
          message = 'API KEY 无效或已过期'
        } else if (code === 429) {
          message = '请求限流，稍后重试'
        } else if (code >= 500) {
          message = '服务端异常'
        } else if (err && err.message) {
          message = err.message
        }
        reject({ providerId: provider.id, error: 'http_error', statusCode: code, message })
      }
    })
  })
}

/**
 * 并发查询所有已配置的供应商
 * @param {Array} providers - 已启用（有 apiKey）的供应商列表
 * @returns {Promise<Array>} 成功/失败的结果数组
 */
export function queryAllBalances(providers) {
  const activeProviders = providers.filter(p => p.apiKey && p.apiKey.trim() !== '')
  if (activeProviders.length === 0) {
    return Promise.resolve([])
  }

  const promises = activeProviders.map(p =>
    queryBalance(p)
      .then(result => ({ status: 'ok', ...result }))
      .catch(error => ({ status: 'error', ...error }))
  )

  return Promise.all(promises)
}

function getAuthHeaderName(provider) {
  if (provider.authType === 'hmac' && provider.hmacConfig) {
    return provider.hmacConfig.headerName || 'Authorization'
  }
  return 'Authorization'
}

// ==============================
// HMAC 签名（仅讯飞星辰需要）
// ==============================
function buildHmacAuth(provider) {
  const config = provider.hmacConfig || {}
  const apiKey = provider.apiKey || ''
  const apiSecret = provider.apiSecret || ''

  if (!apiKey || !apiSecret) {
    return ''
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = Math.random().toString(36).substring(2, 15)
  const signatureRaw = apiKey + timestamp + nonce
  const signature = hmacSha256(apiSecret, signatureRaw)

  // 格式: api_key="xxx",timestamp="xxx",signature="xxx"
  const format = config.format || 'api_key="{apiKey}", timestamp="{timestamp}", signature="{signature}"'
  return format
    .replace('{apiKey}', apiKey)
    .replace('{apiSecret}', apiSecret)
    .replace('{timestamp}', timestamp)
    .replace('{nonce}', nonce)
    .replace('{signature}', signature)
}

// 纯 JS HMAC-SHA256 实现（快应用环境无 crypto 模块）
function hmacSha256(key, message) {
  // 使用简化实现：对 key + message 做 hash
  // 快应用中如不支持原生 crypto，用此 JS 实现
  const blockSize = 64
  let oKeyPad, iKeyPad

  // 确保 key 长度合适
  if (key.length > blockSize) {
    key = sha256Raw(key)
  }
  while (key.length < blockSize) {
    key += '\x00'
  }

  oKeyPad = ''
  iKeyPad = ''
  for (let i = 0; i < blockSize; i++) {
    oKeyPad += String.fromCharCode(key.charCodeAt(i) ^ 0x5c)
    iKeyPad += String.fromCharCode(key.charCodeAt(i) ^ 0x36)
  }

  const inner = sha256Raw(iKeyPad + message)
  return sha256Hex(oKeyPad + inner)
}

// ==============================
// SHA256 纯 JS 实现
// ==============================
function sha256Hex(input) {
  const hash = sha256Raw(input)
  let hex = ''
  for (let i = 0; i < hash.length; i++) {
    const c = hash.charCodeAt(i)
    hex += ('0' + (c & 0xff).toString(16)).slice(-2)
  }
  return hex
}

function sha256Raw(input) {
  // 预处理
  const msg = stringToUTF8Bytes(input)
  const len = msg.length * 8
  msg.push(0x80)
  while ((msg.length * 8 + 64) % 512 !== 0) {
    msg.push(0x00)
  }

  // 附加原始长度（64-bit big-endian）
  const lenBytes = new Array(8)
  for (let i = 7; i >= 0; i--) {
    lenBytes[i] = (len >>> ((7 - i) * 8)) & 0xff
  }
  for (let i = 0; i < 8; i++) {
    msg.push(lenBytes[i])
  }

  // 初始化 hash
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]

  // 处理每个 512-bit 块
  for (let i = 0; i < msg.length; i += 64) {
    const chunk = msg.slice(i, i + 64)
    sha256ProcessBlock(H, chunk)
  }

  // 输出
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += String.fromCharCode(
      (H[i] >>> 24) & 0xff,
      (H[i] >>> 16) & 0xff,
      (H[i] >>> 8) & 0xff,
      H[i] & 0xff
    )
  }
  return result
}

function sha256ProcessBlock(H, chunk) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]

  const W = new Array(64)
  for (let i = 0; i < 16; i++) {
    W[i] = (chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3]
  }
  for (let i = 16; i < 64; i++) {
    W[i] = (sigma1(W[i - 2]) + W[i - 7] + sigma0(W[i - 15]) + W[i - 16]) | 0
  }

  let a = H[0], b = H[1], c = H[2], d = H[3]
  let e = H[4], f = H[5], g = H[6], h = H[7]

  for (let i = 0; i < 64; i++) {
    const T1 = (h + S1(e) + ch(e, f, g) + K[i] + W[i]) | 0
    const T2 = (S0(a) + maj(a, b, c)) | 0
    h = g; g = f; f = e; e = (d + T1) | 0
    d = c; c = b; b = a; a = (T1 + T2) | 0
  }

  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0
  H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0
  H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
}

function S0(x) { return (((x >>> 2) | (x << 30)) ^ ((x >>> 13) | (x << 19)) ^ ((x >>> 22) | (x << 10))) | 0 }
function S1(x) { return (((x >>> 6) | (x << 26)) ^ ((x >>> 11) | (x << 21)) ^ ((x >>> 25) | (x << 7))) | 0 }
function sigma0(x) { return (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) | 0 }
function sigma1(x) { return (((x >>> 17) | (x << 15)) ^ ((x >>> 19) | (x << 13)) ^ (x >>> 10)) | 0 }
function ch(x, y, z) { return ((x & y) ^ (~x & z)) | 0 }
function maj(x, y, z) { return ((x & y) ^ (x & z) ^ (y & z)) | 0 }

function stringToUTF8Bytes(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      // surrogate pair
      i++
      const code2 = str.charCodeAt(i)
      const full = ((code & 0x3ff) << 10) + (code2 & 0x3ff) + 0x10000
      bytes.push(
        0xf0 | (full >> 18),
        0x80 | ((full >> 12) & 0x3f),
        0x80 | ((full >> 6) & 0x3f),
        0x80 | (full & 0x3f)
      )
    }
  }
  return bytes
}
