// Tiny proxy to bypass CORS for AI API providers
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = process.env.PORT || 3456

// MIME types for static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css'
}

// Proxy endpoint: /api/proxy?url=ENCODED_URL
function proxyRequest(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const target = url.searchParams.get('url')
  if (!target) {
    res.writeHead(400)
    return res.end('Missing url param')
  }

  const targetUrl = new URL(target)
  const client = targetUrl.protocol === 'https:' ? https : http

  const headers = {}
  // Forward auth header
  // X-Auth-Raw: pass as-is (for 智谱 coding plan etc.)
  // X-Auth: add Bearer prefix
  const rawAuth = req.headers['x-auth-raw']
  const bearerAuth = req.headers['x-auth']
  if (rawAuth) {
    headers['Authorization'] = rawAuth
  } else if (bearerAuth) {
    headers['Authorization'] = bearerAuth
  }
  // 智谱 coding plan API 需要特定 Accept-Language
  const acceptLang = req.headers['x-accept-lang']
  if (acceptLang) headers['Accept-Language'] = acceptLang
  headers['Accept'] = 'application/json'
  headers['User-Agent'] = 'apiusage-pwa/1.0'

  const proxy = client.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method || 'GET',
    headers: headers,
    timeout: 15000
  }, function (proxyRes) {
    let body = ''
    proxyRes.on('data', function (chunk) { body += chunk })
    proxyRes.on('end', function () {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      })
      res.end(body)
    })
  })

  proxy.on('error', function (e) {
    res.writeHead(502)
    res.end(JSON.stringify({ error: 'proxy_error', message: e.message }))
  })
  proxy.on('timeout', function () {
    proxy.destroy()
    res.writeHead(504)
    res.end(JSON.stringify({ error: 'timeout', message: '请求超时' }))
  })
  proxy.end()
}

// ==================== 商汤 SenseNova 自动登录 ====================
// 用 OAuth2 PKCE + JWE(RSA-OAEP+A256GCM) 加密密码，拿 access_token。
// access_token 3 小时有效，按 username 缓存（留 60s 余量），避免每次刷新都登录。
const snTokenCache = new Map() // username -> {token, tenantId, exp}

function snB64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }

async function snJweEncrypt(password, jwkN, jwkE) {
  // JWE Compact: RSA-OAEP 包外层 CEK，A256GCM 加密明文，AAD=protected header
  const pub = crypto.createPublicKey({ key: { kty: 'RSA', n: jwkN, e: jwkE }, format: 'jwk' })
  const header = snB64url(Buffer.from(JSON.stringify({ alg: 'RSA-OAEP', enc: 'A256GCM' })))
  const cek = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const encKey = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, cek)
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv)
  cipher.setAAD(Buffer.from(header))
  const ct = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return header + '.' + snB64url(encKey) + '.' + snB64url(iv) + '.' + snB64url(ct) + '.' + snB64url(tag)
}

function snReq(url, cookieJar, headers, method, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const cookieStr = Object.keys(cookieJar).map(k => k + '=' + cookieJar[k]).join('; ')
    const h = Object.assign({}, headers || {})
    if (cookieStr) h['Cookie'] = cookieStr
    const opts = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: method || 'GET', headers: h }
    const r = https.request(opts, res => {
      const sc = res.headers['set-cookie']
      if (sc) for (const c of sc) { const m = c.match(/^([^=]+)=([^;]*)/); if (m) cookieJar[m[1].trim()] = m[2] }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

async function senseNovaLogin(username, password) {
  const cached = snTokenCache.get(username)
  if (cached && cached.exp > Math.floor(Date.now() / 1000) + 60) return cached

  const cookieJar = {}
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = 'https://platform.sensenova.cn/oauth2/auth?client_id=nova&redirect_uri=' + encodeURIComponent('https://platform.sensenova.cn') + '&response_type=code&scope=' + encodeURIComponent('openid offline offline_access') + '&state=' + state + '&code_challenge=' + challenge + '&code_challenge_method=S256'
  const ar = await snReq(authUrl, cookieJar, { 'User-Agent': 'apiusage-pwa/1.0' })
  const lcM = (ar.headers.location || '').match(/login_challenge=([a-f0-9]+)/)
  if (!lcM) throw new Error('authorize 失败: ' + ar.status)
  const loginChallenge = lcM[1]

  const jr = await snReq('https://signin.sensecore.cn/.well-known/jwks.json', cookieJar)
  const jwk = JSON.parse(jr.body).keys.find(x => x.kid === 'public:hydra.openid.id-token')
  if (!jwk) throw new Error('jwk 公钥未找到')

  const encPw = await snJweEncrypt(password, jwk.n, jwk.e)
  const loginBody = JSON.stringify({ username: username, password: encPw, challenge: loginChallenge, is_encrypt: true })
  const lr = await snReq('https://iam.sensecoreapi.cn/iam/authn/v1/auth/nova/login', cookieJar, { 'Content-Type': 'application/json', 'Origin': 'https://platform.sensenova.cn', 'Referer': 'https://platform.sensenova.cn/' }, 'POST', loginBody)
  let redirectUrl
  try { redirectUrl = JSON.parse(lr.body).redirect } catch (e) {}
  if (!redirectUrl) throw new Error('nova/login 失败: ' + lr.status + ' ' + lr.body.slice(0, 200))

  // 跟随 302 链（consent → consent_verifier → code）
  let curUrl = redirectUrl, code = null
  for (let i = 0; i < 8; i++) {
    const rr = await snReq(curUrl, cookieJar, { 'Origin': 'https://platform.sensenova.cn', 'Referer': 'https://platform.sensenova.cn/' })
    const loc = rr.headers.location || ''
    const cm = loc.match(/[?&]code=([^&]+)/)
    if (cm) { code = decodeURIComponent(cm[1]); break }
    if (!loc || (rr.status !== 302 && rr.status !== 303 && rr.status !== 307)) throw new Error('重定向链在第 ' + i + ' 步中断: ' + rr.status + ' ' + loc.slice(0, 150))
    curUrl = loc.startsWith('http') ? loc : 'https://platform.sensenova.cn' + loc
  }
  if (!code) throw new Error('未拿到 authorization code')

  const tokenBody = 'code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent('https://platform.sensenova.cn') + '&code_verifier=' + verifier + '&state=' + state + '&client_id=nova&grant_type=authorization_code'
  const tr = await snReq('https://platform.sensenova.cn/oauth2/token', cookieJar, { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://platform.sensenova.cn' }, 'POST', tokenBody)
  let tokenJson
  try { tokenJson = JSON.parse(tr.body) } catch (e) { throw new Error('token 响应非 JSON: ' + tr.body.slice(0, 200)) }
  if (!tokenJson.access_token) throw new Error('token 交换失败: ' + tr.status + ' ' + tr.body.slice(0, 200))

  const payload = JSON.parse(Buffer.from(tokenJson.access_token.split('.')[1], 'base64').toString())
  const tenantId = payload.ext && payload.ext.tenant_id
  const result = { token: tokenJson.access_token, tenantId: tenantId, exp: payload.exp }
  snTokenCache.set(username, result)
  return result
}

// /api/sensenova/login  POST {username, password} → {access_token, tenant_id, exp}
function senseNovaLoginHandler(req, res) {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', async () => {
    const corsHead = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    try {
      const data = JSON.parse(body || '{}')
      if (!data.username || !data.password) {
        res.writeHead(400, corsHead)
        return res.end(JSON.stringify({ error: 'missing_username_or_password' }))
      }
      const r = await senseNovaLogin(data.username, data.password)
      res.writeHead(200, corsHead)
      res.end(JSON.stringify({ access_token: r.token, tenant_id: r.tenantId, exp: r.exp }))
    } catch (e) {
      res.writeHead(502, corsHead)
      res.end(JSON.stringify({ error: 'login_failed', message: e.message }))
    }
  })
}

// Serve static files
function serveStatic(req, res) {
  let filePath = (req.url === '/' ? '/index.html' : req.url).split('?')[0]
  filePath = path.join(__dirname, filePath)

  // 防路径穿越：解析后的绝对路径必须仍位于 web/ 目录内
  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  const ext = path.extname(filePath)
  const mime = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404)
      return res.end('Not found')
    }
    res.writeHead(200, { 'Content-Type': mime })
    res.end(data)
  })
}

const server = http.createServer(function (req, res) {
  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    })
    return res.end()
  }

  if (req.url.startsWith('/api/sensenova/login')) {
    return senseNovaLoginHandler(req, res)
  }
  if (req.url.startsWith('/api/proxy')) {
    return proxyRequest(req, res)
  }

  serveStatic(req, res)
})

server.listen(PORT, function () {
  console.log('API 用量 PWA 服务已启动: http://localhost:' + PORT)
  // Print LAN IP
  const os = require('os')
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log('局域网地址: http://' + iface.address + ':' + PORT)
      }
    }
  }
})
