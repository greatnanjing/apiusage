// 8 家供应商预置配置模板
// 用户通过 JSON 批量导入时，会合并此模板与用户数据

export const PROVIDER_TEMPLATES = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/user/balance',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'balance_infos[0].total_balance',
      currencyPath: 'balance_infos[0].currency'
    }
  },
  {
    id: 'kimi',
    name: 'Kimi / 月之暗面',
    apiKey: '',
    endpoint: 'https://api.moonshot.cn/v1/users/me/balance',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'data.available_balance',
      voucherPath: 'data.voucher_balance',
      cashPath: 'data.cash_balance'
    }
  },
  {
    id: 'siliconflow',
    name: '硅基智能 / SiliconFlow',
    apiKey: '',
    endpoint: 'https://api.siliconflow.cn/v1/user/info',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'data.totalBalance',
      chargeBalancePath: 'data.chargeBalance',
      namePath: 'data.name'
    }
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 / StepFun',
    apiKey: '',
    endpoint: 'https://api.stepfun.com/v1/accounts',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'balance',
      cashPath: 'total_cash_balance',
      voucherPath: 'total_voucher_balance',
      typePath: 'type'
    }
  },
  {
    id: 'zhipu',
    name: '智谱 / GLM',
    apiKey: '',
    endpoint: 'https://bigmodel.cn/api/biz/account/query-customer-account-report',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'data.balance',
      availableBalancePath: 'data.availableBalance',
      rechargePath: 'data.rechargeAmount',
      giftPath: 'data.giveAmount',
      creditPath: 'data.creditBalance'
    }
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiKey: '',
    endpoint: 'https://www.minimaxi.com/account/query_balance',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'available_amount',
      cashPath: 'cash_balance',
      voucherPath: 'voucher_balance',
      creditPath: 'credit_balance',
      owedPath: 'owed_amount'
    }
  },
  {
    id: 'volcengine',
    name: '火山引擎 / 豆包',
    apiKey: '',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/balance',
    method: 'GET',
    authType: 'bearer',
    responseMapping: {
      balancePath: 'result.balance',
      currencyPath: 'result.currency'
    }
  },
  {
    id: 'iflytek',
    name: '讯飞星辰',
    apiKey: '',
    apiSecret: '',
    endpoint: 'https://spark-api-open.xf-yun.com/v1/user/balance',
    method: 'GET',
    authType: 'hmac',
    hmacConfig: {
      headerName: 'Authorization',
      algorithm: 'hmac-sha256',
      format: 'api_key="{apiKey}",signature="{signature}"'
    },
    responseMapping: {
      balancePath: 'data.balance',
      usedPath: 'data.used',
      totalPath: 'data.total'
    }
  }
]

// 生成完整 JSON 模板（给用户导出用）
export function generateImportTemplate() {
  return JSON.stringify({ providers: PROVIDER_TEMPLATES }, null, 2)
}

// 根据 id 查找模板
export function getTemplateById(id) {
  return PROVIDER_TEMPLATES.find(p => p.id === id) || null
}
