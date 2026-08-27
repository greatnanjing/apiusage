# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

AI API 余额/用量查询工具，同一套功能在**两个独立平台**各实现一遍：

- `src/` — **快应用**（Quick App，小米/HyperOS 原生），`.ux` 单文件组件 + `@system.*` 接口，用 hap-toolkit 构建。
- `web/` — **PWA**，`index.html` 是一个单文件全栈应用（HTML+CSS+JS 全部内联，无打包步骤），可纯静态托管。

两个平台功能对等，供应商模板、请求逻辑、解析逻辑都各自维护一份手写副本——这是改动时最容易遗漏的点（见下文「重要约束」）。

## 常用命令

```bash
# 快应用（需要 hap-toolkit，npm install 后可用）
npm start            # hap server --watch，开发热更新（配合小米快应用调试器）
npm run build        # hap build，产物为 .rpk 包（dist/）
npm run release      # hap release，发布构建

# web（无构建步骤）
node web/server.js   # 启动 3456 端口：静态托管 web/ + /api/proxy CORS 代理
                     # 局域网地址会打印到控制台，供手机访问
# 也可用任意静态服务器托管 web/（python -m http.server --directory web 等）
```

部署：push 到 `main` 即触发 GitHub Pages 自动部署，站点路径为 `/apiusage/web/`（web 资源用相对路径，必须部署在仓库的 `web/` 子目录下）。

## 架构

### 1. 双平台、双份代码（最关键的「big picture」）

同一个功能在 `web/index.html`（原生 JS）和 `src/`（快应用 ES module + `.ux`）里各写一遍。两边对应关系：

| 关注点 | 快应用 | web |
|--------|--------|-----|
| 供应商模板 | `src/common/providers.js` `PROVIDER_TEMPLATES` | `index.html` `TEMPLATES` |
| 发请求 | `src/common/api.js` `queryBalance`（`@system.fetch`，无 CORS 限制） | `index.html` `callApi`（`fetch`，受 CORS） |
| 解析响应 | `src/common/parser.js` `parseResponse`/`getPath` | `index.html` `buildCard`/`getPath` |
| 智谱 Coding Plan | `api.js` `fetchZhipuCodingPlan` + `parser.js` `parseZhipuCpData` | `index.html` `queryZhipuCodingPlan`/`parseZhipuCpData` |
| 商汤各模型余量 | （待同步到 src/，快应用仅手动 token 可行） | `index.html` `querySenseNovaUsage`/`parseSenseNovaData`/`decodeJwtTenantId` |
| 存储 | `src/common/storage.js`（`@system.storage`） | `index.html`（`localStorage`） |
| 页面 | `src/pages/index/index.ux` + `src/components/*.ux` | `index.html` |

**新增/修改供应商、调整解析逻辑时，两边的模板字段、请求头、路径表达式必须保持一致。**

### 2. 9 家供应商 + 配置驱动解析

支持 DeepSeek、Kimi、硅基流动、阶跃星辰、智谱、MiniMax、火山引擎、讯飞、商汤 SenseNova（见 `PROVIDER_TEMPLATES`）。前 8 家每家是一份「模板」：`endpoint` + `method` + `authType` + `responseMapping`。

`responseMapping` 用点路径 + 数组索引描述如何从各家形状各异的 JSON 里取值，如 `"balance_infos[0].total_balance"`、`"data.balance"`。`getPath`/`parsePath`（快应用）和 `getPath`（web）实现这套路径语法——新增供应商只需配 mapping，不必写专门解析代码。

**商汤是例外**：返回 `{"model_remaining_percent": {模型名: 剩余百分比}}`（各模型 5 小时窗口余量，多模型嵌套 map），无法用 responseMapping 表达，走独立查询函数（web: `querySenseNovaUsage`/`parseSenseNovaData`/`decodeJwtTenantId`，参考智谱 CP 模式）；鉴权也不同于前 8 家（见下文）。

### 3. 鉴权规则

- 前 8 家供应商：`Authorization: Bearer <apiKey>`。
- **例外：智谱 Coding Plan 配额接口**（`open.bigmodel.cn/api/monitor/usage/quota/limit`）——apiKey **原样放入 Authorization（不加 Bearer 前缀）**，且需要 `Accept-Language: en-US,en`。响应里 `type==='TOKENS_LIMIT'`（正式包 token 配额）与 `type==='CREDIT_LIMIT'`（GLM-7days-trial 等体验包 credit 配额）的条目均按 `unit` 区分窗口：`unit===3` → 5 小时，`unit===6` → 7 天；同窗口两类并存时 TOKENS_LIMIT 优先。
- **例外：商汤 SenseNova**——鉴权是 **OAuth2 JWT access_token**（非 API key），需走完整 OAuth2 PKCE + JWE(`RSA-OAEP`/`A256GCM` 加密密码) 登录 `iam.sensecoreapi.cn/iam/authn/v1/auth/nova/login` 拿取；token 3 小时有效，无 refresh_token。web 端 `server.js` 提供 `/api/sensenova/login` 端点自动登录（`senseNovaLogin`，按 username 缓存 token 3h）；前端 `querySenseNovaUsage` 支持「手机号\|PIN」自动登录与 access_token 手动两种模式。`account_id` 从 JWT payload 的 `ext.tenant_id` 解码，用户免填。

### 4. web 的 CORS 双模式（`index.html` 启动时自动选择）

`detectProxy()` 请求 `/api/proxy`，据响应判定运行环境：

- **有代理**（`web/server.js` 跑着）：浏览器请求 `/api/proxy?url=<编码后的 endpoint>`，由服务器转发，可访问**任何**供应商（绕过 CORS）。鉴权通过自定义头 `X-Auth`（加 Bearer）/ `X-Auth-Raw`（原样，给智谱 CP）/ `X-Accept-Lang` 传入，服务器再拼回标准头。
- **无代理**（静态托管如 GitHub Pages）：浏览器直连各供应商 endpoint。此时**只能用支持 CORS 的供应商**（DeepSeek/Kimi/硅基/阶跃/智谱等），MiniMax/火山/讯飞/商汤会被浏览器 CORS 拦截（商汤 `platform.sensenova.cn` 控制台接口跨域实测被拦）。直连模式下浏览器禁止设置 `Accept-Language`，但解析字段与语言无关，智谱 CP 仍可用。商汤自动登录需 server.js 的 `/api/sensenova/login`，静态模式不可用。

快应用走 `@system.fetch`，不存在 CORS 问题，所有供应商都能用。

### 5. 数据存储（仅设备本地）

- 快应用：`@system.storage`，key 为 `providers_config`（配置）和 `last_snapshot`（上次查询快照）。
- web：`localStorage`，key 为 `apiusage_providers`、`apiusage_cards`、`apiusage_cards_order`（后者记录用户拖拽排序）。

## 重要约束

- **API KEY 绝不入库**：仓库里的模板 `apiKey` 恒为空字符串，真实 key 只存在用户设备（手机 storage / 浏览器 localStorage），因此仓库可安全公开。商汤的「手机号\|PIN」也只存用户设备（apiKey 字段），server.js 的 token 缓存只在内存（重启清空）。
- **商汤自动登录需 server.js**：`/api/sensenova/login` 端点（OAuth2 PKCE + JWE 加密密码）只在 `node web/server.js` 代理模式可用；GitHub Pages 静态模式商汤自动登录不可用（卡片显示「自动登录需代理」），手动 access_token 模式也需代理转发（CORS 实测被拦）。快应用 `@system.fetch` 无 CORS 可直连商汤，但 JWE 自动登录难在快应用实现（需 RSA 库），故快应用端暂未同步商汤。
- **web/index.html 是单文件**：HTML/CSS/JS 全部内联，改 web 端只动这一个文件；新增供应商要在文件内同步改 `TEMPLATES`、`LABEL_MAP`、解析与渲染逻辑。
- **快应用受 manifest 约束**：`src/manifest.json` 声明了 `system.fetch`/`storage`/`clipboard`/`prompt`/`shortcut`/`router` 等 feature 与 `origin: *` 权限；`designWidth: 750`。新增系统接口需在此声明。
- **service worker（重点踩坑历史）**：`web/sw.js` 的缓存策略必须分两类——**HTML 导航请求用 network-first**（曾经误用 cache-first，把旧 `index.html` 卡死，用户永远拿不到新版），静态资源才用 cache-first；并显式跳过 `/api/`、非 GET、跨域请求（否则会缓存余额响应导致数据不刷新）。修改 sw.js 时务必三件事一起做：① 递增 `CACHE_NAME` 并在 `activate` 里清理旧缓存；② 同步递增 `index.html` 里 `register('sw.js?v=N')` 的版本号——GitHub Pages 对 sw.js 返回 `Cache-Control: max-age=600`，不带版本号浏览器最多 10 分钟检测不到 SW 更新；③ 页面已监听 `controllerchange` 自动 reload，让用户无感拿到新版。若用户浏览器被旧 SW 卡死，访问 `/web/unregister.html`（新 URL，旧 SW 的 cache-first 未命中 → 回退网络加载该页）可注销全部 SW + 清空缓存后跳回主页恢复。
