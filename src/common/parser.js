/**
 * 根据 responseMapping 从 API 返回的原始 JSON 中提取数据
 *
 * path 支持两种语法：
 *   "data.balance"       -> 按 . 逐级访问
 *   "balance_infos[0].total_balance" -> 支持数组索引
 *
 * @param {Object} raw         - API 返回的完整 JSON
 * @param {Object} mapping     - 供应商的 responseMapping 配置
 * @returns {Object} 提取后的结构化数据 { balance, currency, extra: {...} }
 */
export function parseResponse(raw, mapping) {
  if (!raw || !mapping) {
    return { balance: null, extra: {} }
  }

  const result = {
    balance: getPath(raw, mapping.balancePath),
    currency: getPath(raw, mapping.currencyPath) || 'CNY',
    extra: {}
  }

  // 提取所有非核心字段到 extra
  const coreKeys = ['balancePath', 'currencyPath']
  for (const key of Object.keys(mapping)) {
    if (coreKeys.includes(key)) continue
    const label = key.replace('Path', '') // 去掉 Path 后缀
    result.extra[label] = getPath(raw, mapping[key])
  }

  return result
}

function getPath(obj, path) {
  if (!path || !obj) return null

  const segments = parsePath(path)
  let current = obj

  for (const seg of segments) {
    if (current === null || current === undefined) return null
    if (seg.type === 'key') {
      current = current[seg.value]
    } else if (seg.type === 'index') {
      if (Array.isArray(current)) {
        current = current[seg.value]
      } else {
        return null
      }
    }
  }

  return current !== undefined ? current : null
}

function parsePath(path) {
  // 将 "balance_infos[0].total_balance" 解析为 [{key:'balance_infos'}, {index:0}, {key:'total_balance'}]
  const segments = []
  const parts = path.split('.')
  for (const part of parts) {
    const match = part.match(/^(.+?)\[(\d+)\]$/)
    if (match) {
      segments.push({ type: 'key', value: match[1] })
      segments.push({ type: 'index', value: parseInt(match[2], 10) })
    } else {
      segments.push({ type: 'key', value: part })
    }
  }
  return segments
}

/**
 * 将提取结果格式化为卡片展示用的数据
 */
export function formatForDisplay(parsed) {
  if (!parsed || parsed.balance === null || parsed.balance === undefined) {
    return { balanceDisplay: '—', status: 'unknown' }
  }

  const balance = Number(parsed.balance)
  const currency = parsed.currency || 'CNY'

  let balanceDisplay = ''
  if (currency === 'CNY' || currency === 'USD') {
    const symbol = currency === 'CNY' ? '¥' : '$'
    balanceDisplay = symbol + balance.toFixed(2)
  } else {
    balanceDisplay = String(balance) + ' ' + currency
  }

  const status = balance <= 0 ? 'exhausted' : balance < 10 ? 'low' : 'ok'

  return { balanceDisplay, status, balance, currency, extra: parsed.extra }
}

/**
 * 解析智谱 Coding Plan 用量数据（与 web 版 parseZhipuCpData 一致）
 *
 * 接口返回的 data.limits 中，type 为 TOKENS_LIMIT 的条目：
 *   unit === 3 -> 5 小时窗口用量（fiveHour）
 *   unit === 6 -> 7 天窗口用量（weekly）
 *
 * @param {Object} json - 智谱 Coding Plan 接口的原始 JSON
 * @returns {null | {fiveHour?: {pct, remaining}, weekly?: {pct, remaining}}}
 */
export function parseZhipuCpData(json) {
  if (!json || !json.success || !json.data || !json.data.limits) return null

  const limits = json.data.limits
  const result = {}
  for (let i = 0; i < limits.length; i++) {
    const item = limits[i]
    if (item.type !== 'TOKENS_LIMIT') continue
    const pct = Number(item.percentage) || 0
    let remaining = ''
    if (item.nextResetTime) {
      let resetMs = Number(item.nextResetTime)
      if (resetMs < 1e12) resetMs *= 1000 // 秒 → 毫秒
      remaining = formatRemaining(resetMs - Date.now())
    }
    if (item.unit === 3) {
      result.fiveHour = { pct: pct, remaining: remaining }
    } else if (item.unit === 6) {
      result.weekly = { pct: pct, remaining: remaining }
    }
  }
  return result
}

/**
 * 解析商汤 SenseNova 各模型余量（与 web 版 parseSenseNovaData 一致）
 * 返回 [{name, pct}]，按余量升序（低的在前，便于发现快用完的模型）
 */
export function parseSenseNovaData(json, modelList) {
  if (!json || !json.model_remaining_percent) return []
  const map = json.model_remaining_percent
  return modelList.map(function (name) {
    return { name: name, pct: Math.round((Number(map[name]) || 0) * 100) / 100 }
  }).sort(function (a, b) { return a.pct - b.pct })
}

/**
 * 从 access_token(JWT) 解码 tenant_id 作为 account_id（与 web 版 decodeJwtTenantId 一致）
 * 快应用环境可能无 atob，用 polyfill 兜底（JWT payload 为 ASCII JSON，polyfill 足够）
 */
export function decodeJwtTenantId(token) {
  try {
    const parts = (token || '').split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(b64urlDecode(parts[1]))
    return (payload.ext && payload.ext.tenant_id) || null
  } catch (e) { return null }
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  if (typeof atob === 'function') return atob(s)
  // polyfill（逐 4 字符解码 3 字节，ASCII 足够）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let str = ''
  for (let i = 0; i < s.length; i += 4) {
    const a = chars.indexOf(s[i])
    const b = chars.indexOf(s[i + 1])
    const c = s[i + 2] ? chars.indexOf(s[i + 2]) : -1
    const d = s[i + 3] ? chars.indexOf(s[i + 3]) : -1
    const n = (a << 18) | (b << 12) | (c >= 0 ? c << 6 : 0) | (d >= 0 ? d : 0)
    if (c >= 0) str += String.fromCharCode((n >> 16) & 255)
    if (d >= 0) str += String.fromCharCode((n >> 8) & 255)
  }
  return str
}

/**
 * 将剩余毫秒数格式化为简短文案（与 web 版 formatRemaining 一致）
 */
export function formatRemaining(ms) {
  if (ms <= 0) return '即将重置'
  const minutes = Math.floor(ms / 1000 / 60)
  let hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  hours = hours % 24
  const mins = minutes % 60
  if (days > 0) return days + 'd' + (hours > 0 ? hours + 'h' : '')
  if (hours > 0) return hours + 'h' + (mins > 0 ? mins + 'm' : '')
  return mins + 'm'
}
