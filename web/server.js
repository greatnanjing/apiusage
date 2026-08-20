// Tiny proxy to bypass CORS for AI API providers
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

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
