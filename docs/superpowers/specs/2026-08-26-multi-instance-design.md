# 多实例供应商设计

## 背景

当前每家供应商模板只能添加一个实例（按模板 id 去重）。用户需要同一家供应商添加多个实例（不同账号/API key），用自定义名称区分。敏感数据（KEY/账户/PIN/URL）只存本地，不上服务器。

## 目标

- 同一供应商模板可添加多个实例
- 添加/编辑时可自定义名称、URL、KEY、账户
- 列表显示自定义名称
- 商汤：account(手机号)+apiKey(PIN) 拆分，自动登录拼 `手机号|PIN`；或 apiKey 当 token 手动模式
- 全本地存储（web localStorage + 快应用 storage）
- 双端（web + 快应用）同步

## 数据结构

```
provider = {
  uid: string,        // 实例唯一 id（p_<时间戳>_<随机>）
  tid: string,        // 模板类型（deepseek/sensenova/...）
  name: string,       // 自定义名称
  endpoint: string,   // API URL
  apiKey: string,     // KEY（商汤=PIN，其他=apiKey）
  account: string,    // 账户（商汤=手机号，其他=空）
  method: string,     // 从模板复制
  authType: string,   // 从模板复制
  responseMapping: object  // 从模板复制
}
```

`TEMPLATES`/`PROVIDER_TEMPLATES` 不变（9 个，apiKey 空）。添加时复制 `method/authType/responseMapping` 到 provider。

## 添加（openAdd/confirmAdd）

- openAdd 列模板，**可重复勾选**（不排除已添加）
- 勾选后显示 `name/endpoint/apiKey/account` 输入框：
  - name 默认模板 name，可编辑（空则 fallback 模板 name）
  - endpoint 默认模板 endpoint，可编辑
  - apiKey 空（占位 API KEY / PIN）
  - account 空（占位 账户/手机号）——**仅 `tid==='sensenova'` 显示 account 输入框**，其他供应商隐藏（无 account 概念）
- confirmAdd：生成 uid `p_${Date.now()}_${Math.random().toString(36).slice(2,8)}`，push providers

## 编辑（editOne）

- 按 `uid` 找 provider
- 改 `name/endpoint/apiKey/account`
- 商汤隐藏 endpoint（查询走硬编码 URL），account 占位「手机号」、KEY 占位「PIN」

## 卡片（renderAll）

- 显示 `c.name`（自定义名）
- 智谱 codingPlan / 商汤 sensenovaModels 按 `tid` 触发

## 查询（refreshAll/refreshOne）

- `callApi(prov)` 通用（用 endpoint + `Bearer apiKey`）
- 商汤跳过 callApi（`tid==='sensenova'`），走 `querySenseNovaUsage`
- `queryZhipuCodingPlan`: `tid==='zhipu'`
- `querySenseNovaUsage`: `tid==='sensenova'`
  - `account` 有值 → 自动登录（拼 `account|apiKey` 即 手机号|PIN，调 `/api/sensenova/login`）
  - `account` 空 → apiKey 当 access_token 手动模式（`decodeJwtTenantId`）

## 存储（全本地）

- web: `localStorage`（`apiusage_providers` + `apiusage_cards` + `apiusage_cards_order`），含 apiKey/account
- 快应用: `@system.storage`（`providers_config` + `last_snapshot`）
- 不上服务器

## 旧数据迁移

- 加载时若 provider 无 `uid/tid` → `uid=id, tid=id, account=''`
- 旧配置平滑升级

## 双端

- `web/index.html` + `src/`(providers.js/api.js/parser.js/index.ux) 同步改

## 不做（YAGNI）

- 服务器存储/同步（用户选全本地）
- 账户系统
