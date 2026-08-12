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
