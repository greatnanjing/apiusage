import fetch from '@system.fetch'
import { decodeJwtTenantId } from './parser.js'

// 默认超时 10 秒
const DEFAULT_TIMEOUT = 10000

/**
 * 根据供应商配置发起 HTTP 请求（Bearer 鉴权，与 web 版 callApi 一致）
 * @param {Object} provider - 供应商配置对象
 * @returns {Promise<Object>} 解析后的余额数据
 */
export function queryBalance(provider) {
  return new Promise((resolve, reject) => {
    fetch.fetch({
      url: provider.endpoint,
      method: provider.method || 'GET',
      header: {
        'Authorization': 'Bearer ' + (provider.apiKey || ''),
        'Accept': 'application/json'
      },
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

// ==============================
// 智谱 Coding Plan（与 web 版 queryZhipuCodingPlan 一致）
// ==============================

const ZHIPU_CODING_PLAN_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'

/**
 * 查询智谱 Coding Plan 用量配额。
 * 注意：该接口需要把 apiKey 原样放入 Authorization（不加 Bearer 前缀），
 * 并带特定 Accept-Language 头，与 web 版 X-Auth-Raw / X-Accept-Lang 行为一致。
 * @param {string} apiKey - 智谱 apiKey
 * @returns {Promise<Object>} 接口返回的原始 JSON
 */
export function fetchZhipuCodingPlan(apiKey) {
  return new Promise((resolve, reject) => {
    fetch.fetch({
      url: ZHIPU_CODING_PLAN_URL,
      method: 'GET',
      header: {
        'Authorization': apiKey || '',
        'Accept-Language': 'en-US,en',
        'Accept': 'application/json'
      },
      responseType: 'json',
      timeout: DEFAULT_TIMEOUT,
      success: function (resp) {
        try {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data
          resolve(data)
        } catch (e) {
          reject(new Error('响应解析失败'))
        }
      },
      fail: function (err, code) {
        reject(new Error((err && err.message) || 'HTTP ' + code))
      }
    })
  })
}

// ==============================
// 商汤 SenseNova 各模型余量（与 web 版 querySenseNovaUsage 一致，快应用端仅手动 token 模式）
// ==============================

const SENSENOVA_MODELS_URL = 'https://platform.sensenova.cn/lite/console/v1/models'
const SENSENOVA_USAGE_URL = 'https://platform.sensenova.cn/lite/console/v1/user/coding-plan/usages'

function snFetch(url, token) {
  return new Promise((resolve, reject) => {
    fetch.fetch({
      url: url,
      method: 'GET',
      header: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      responseType: 'json',
      timeout: DEFAULT_TIMEOUT,
      success: function (resp) {
        try {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data
          resolve(data)
        } catch (e) { reject(new Error('响应解析失败')) }
      },
      fail: function (err, code) {
        let msg = 'HTTP ' + code
        if (code === 401) msg = 'token 已失效'
        reject(new Error(msg))
      }
    })
  })
}

/**
 * 查询商汤各模型 5 小时窗口余量。快应用无 CORS，直连 platform.sensenova.cn。
 * apiKey 填 access_token(JWT)；account_id 从 token 解码，先调 models 拿列表，再调 coding-plan/usages 拿余量。
 * @param {string} apiKey - 商汤 access_token
 * @returns {Promise<{models: string[], usages: Object}>}
 */
export function fetchSenseNovaUsage(account, apiKey) {
  const acc = (account || '').trim()
  const token = (apiKey || '').trim()
  // 快应用无 server.js 代理，不支持 account(手机号)+PIN 自动登录，仅手动 access_token
  if (acc) return Promise.reject(new Error('快应用不支持自动登录，请填 access_token'))
  const tenantId = decodeJwtTenantId(token)
  if (!tenantId) return Promise.reject(new Error('token 格式无效'))
  return snFetch(SENSENOVA_MODELS_URL, token).then(function (mj) {
    const modelList = (mj && mj.models) || []
    if (!modelList.length) return { models: [], usages: null }
    const qs = modelList.map(function (m) { return 'model_ids=' + encodeURIComponent(m) }).join('&')
    const usageUrl = SENSENOVA_USAGE_URL + '?account_id=' + tenantId + '&' + qs
    return snFetch(usageUrl, token).then(function (uj) {
      return { models: modelList, usages: uj }
    })
  })
}
