# web 端卡片"X分钟前更新"显示 — 设计文档

日期:2026-08-20

## 背景与目标

快应用端已有 `timeAgo` 相对时间显示([src/components/provider-card.ux:55-61](../../../src/components/provider-card.ux)),web 端数据层早已记录 `lastUpdate: Date.now()`([web/index.html:548](../../../web/index.html) 的 `buildCard`),但渲染时未使用。本次补齐 web 端显示,并让相对时间随时间自动流动("刚刚 → 1分钟前 → 2分钟前…"),对标 CC Switch 的体验。

## 方案

独立 `timeAgo` 函数 + 60 秒定时器只更新时间元素文本(**不**走每分钟 `renderAll()` 全量重渲染——那会打断用户拖拽、重置滚动)。

## 设计细节

### 1. `timeAgo(ts)` 函数与档位

| 经过时间 | 显示 |
|---|---|
| < 1 分钟 | 刚刚 |
| < 1 小时 | X分钟前 |
| < 24 小时 | X小时前 |
| ≥ 24 小时 | X天前 |

前三档与快应用端现有规则完全一致;"天"档为双端本次共同新增。

### 2. 显示位置与结构

余额下方右对齐小灰字,与快应用端位置、样式对应。渲染时把 `.card-balance` 包进右对齐列容器,余额 + 更新时间竖排:

```
⋮⋮  DeepSeek [正常]      ¥12.34
                          3分钟前
    [刷新] [编辑] [删除]
```

- HTML:`<div class="card-balance-wrap">` 内含 `.card-balance` 与 `<div class="card-update" data-last-update="<ts>">`
- CSS:`.card-balance-wrap{display:flex;flex-direction:column;align-items:flex-end}`;`.card-update{font-size:10px;color:#bbb;margin-top:2px}`

### 3. 定时自动流动

页面级一次性 `setInterval(60s)`:遍历 `document.querySelectorAll('[data-last-update]')`,用 `timeAgo(parseInt(attr))` 更新 `textContent`。不重建 DOM,不触发 `save()`。页面切后台时照跑(元素少,开销可忽略,不做 visibilitychange 优化)。

`renderAll` 每次重建 DOM 后 `data-last-update` 属性随卡片重新生成,定时器与渲染路径天然兼容,无需联动。

### 4. 边界情况

- 错误卡片(含 `lastUpdate: Date.now()`,[web/index.html:415](../../../web/index.html))照样显示时间——可看出错误发生时机。
- 旧版本 localStorage 卡片无 `lastUpdate` 字段 → 不渲染该行(与快应用 `lastUpdate > 0` 才显示一致)。
- 智谱 Coding Plan 并行查询完成后会再次 `renderAll()`([web/index.html:454](../../../web/index.html)),时间文本随之刷新,无需特殊处理。

### 5. 快应用端对齐(最小改动)

仅在 [provider-card.ux](../../../src/components/provider-card.ux) 的 `timeAgo` computed 中补"≥24 小时 → X天前"一档,保持双端档位规则一致。**不加**自动流动定时器:快应用即开即看、停留短,且让 computed 定期重算需动页面数据结构,改动不成比例。

### 6. 不涉及 service worker

纯 HTML 内联 JS 变化,不涉及 `web/sw.js` 缓存策略,无需递增 CACHE_NAME。
