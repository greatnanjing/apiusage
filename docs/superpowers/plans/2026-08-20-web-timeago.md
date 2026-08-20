# web 端卡片"X分钟前更新"显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web 端(PWA)卡片余额下方显示"刚刚/X分钟前/X小时前/X天前"相对更新时间,并每分钟自动流动;快应用端 timeAgo 补"X天前"档位保持双端规则一致。

**Architecture:** 独立 `timeAgo(ts)` 纯函数 + 渲染时给时间元素带 `data-last-update` 属性 + 页面级 `setInterval(60s)` 调 `updateTimeAgoTexts()` 只更新文本(不重建 DOM、不触发 `save()`)。数据层 `lastUpdate` 字段已存在([web/index.html:548](../../../web/index.html) 的 `buildCard`、错误分支 415 行),本次只补 UI。

**Tech Stack:** 原生 JavaScript(单文件内联,无构建)、快应用 `.ux` 组件。

**Spec:** [docs/superpowers/specs/2026-08-20-web-timeago-design.md](../specs/2026-08-20-web-timeago-design.md)

## Global Constraints

- 项目无测试框架、无 lint;验证 = `node web/server.js` + 浏览器控制台断言(快应用端为代码审查级验证)。
- `web/index.html` 为单文件应用,所有 web 改动都在这一个文件内,风格保持 ES5(`var`、`function` 声明、字符串拼接,不用模板字符串/箭头函数)。
- 双平台档位规则必须一致:刚刚 / X分钟前 / X小时前 / X天前。
- **不改 `web/sw.js`**,不递增 CACHE_NAME(纯 HTML 内联 JS 变化)。
- API KEY 绝不入库(本次不涉及)。
- 提交信息用中文。

---

### Task 1: web 端 timeAgo 显示 + 60 秒自动流动

**Files:**
- Modify: `web/index.html`(4 处:CSS 约 52 行后、渲染约 310 行、工具函数约 405 行 `esc` 附近、初始化约 725 行)

**Interfaces:**
- Consumes: 卡片对象的 `lastUpdate` 字段(毫秒时间戳,`buildCard` 与错误分支已写入;旧数据可能缺失)
- Produces:
  - `timeAgo(ts: number): string` — 纯函数
  - `updateTimeAgoTexts(): void` — 遍历 `[data-last-update]` 元素刷新文本
  - DOM 约定:每个时间元素 `<div class="card-update" data-last-update="<ts>">`

- [ ] **Step 1: 加 CSS 样式**

在 `web/index.html` 中 `.card-balance` 那一行(约 52 行):

```css
.card-balance{font-size:16px;font-weight:700;color:#1a1a1a;text-align:right;white-space:nowrap}
```

之后新增两行:

```css
.card-balance-wrap{display:flex;flex-direction:column;align-items:flex-end}
.card-update{font-size:10px;color:#bbb;margin-top:2px}
```

- [ ] **Step 2: 加 `timeAgo` 与 `updateTimeAgoTexts` 函数**

在 `// ==================== Helpers ====================` 区域的 `esc` 函数(约 405 行)之后新增:

```js
function timeAgo(ts) {
  var diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return Math.floor(diff / 86400000) + '天前'
}
function updateTimeAgoTexts() {
  var els = document.querySelectorAll('[data-last-update]')
  for (var i = 0; i < els.length; i++) {
    els[i].textContent = timeAgo(parseInt(els[i].getAttribute('data-last-update'), 10))
  }
}
```

注意:`esc` 函数定义在 405 行附近,但渲染代码在它之前执行也没关系(函数声明会提升,且渲染发生在 DOMContentLoaded)。

- [ ] **Step 3: 修改 `renderAll` 渲染**

在 `renderAll` 中(约 310 行),把这一行:

```js
        '<span class="card-balance">' + esc(c.balanceText || '—') + '</span>' +
```

替换为:

```js
        '<div class="card-balance-wrap">' +
          '<span class="card-balance">' + esc(c.balanceText || '—') + '</span>' +
          (c.lastUpdate ? '<div class="card-update" data-last-update="' + c.lastUpdate + '">' + timeAgo(c.lastUpdate) + '</div>' : '') +
        '</div>' +
```

说明:`c.lastUpdate` 为 `Date.now()` 产生的纯数字,直接拼入属性安全,无需 `esc`;缺失(旧 localStorage 数据)则整行不渲染,与快应用 `lastUpdate > 0` 才显示的行为一致。

- [ ] **Step 4: 挂载 60 秒定时器**

在 `DOMContentLoaded` 初始化块中,`if (cards.length) renderAll()`(约 725 行)之后新增:

```js
  // 相对时间每分钟自动流动（只更新文本，不重渲染卡片，避免打断拖拽）
  setInterval(updateTimeAgoTexts, 60000)
```

- [ ] **Step 5: 浏览器验证**

Run: `node web/server.js`(3456 端口),浏览器打开 `http://localhost:3456`。

若浏览器已有配置过的供应商(localStorage 有数据),刷新后每张卡片余额下方应出现灰字;若无配置,在 DevTools 控制台逐条断言:

```js
timeAgo(Date.now() - 30*1000)            // 期望: "刚刚"
timeAgo(Date.now() - 5*60*1000)          // 期望: "5分钟前"
timeAgo(Date.now() - 2*60*60*1000)       // 期望: "2小时前"
timeAgo(Date.now() - 3*24*60*60*1000)    // 期望: "3天前"
updateTimeAgoTexts()                     // 期望: undefined,无报错
document.querySelectorAll('.card-update').length  // 期望: 已配置且刷新成功的卡片数
```

再向 localStorage 手工塞一条卡片数据验证渲染路径(含/不含 `lastUpdate` 两种):

```js
localStorage.setItem('apiusage_providers', JSON.stringify([{id:'deepseek',name:'DeepSeek',apiKey:'sk-test',endpoint:'https://api.deepseek.com/user/balance'}]))
localStorage.setItem('apiusage_cards', JSON.stringify([{id:'deepseek',name:'DeepSeek',status:'unknown',statusLabel:'未知',balanceText:'¥1.00',extraRows:[],lastUpdate:Date.now() - 5*60*1000}]))
location.reload()
```

Expected: 卡片余额下方显示"5分钟前";等约 1 分钟观察其变为"6分钟前"(自动流动)。把 `lastUpdate` 去掉再 reload,该行消失。

验证完清掉测试数据(控制台 `localStorage.clear()` 后 reload,恢复你自己的真实配置——若之前有)。

- [ ] **Step 6: 提交**

```bash
git add web/index.html
git commit -m "✨ feat: web端卡片显示\"X分钟前\"更新时间并每分钟自动流动"
```

---

### Task 2: 快应用端 timeAgo 补"X天前"档位

**Files:**
- Modify: `src/components/provider-card.ux:55-61`(`timeAgo` computed)

**Interfaces:**
- Consumes: `result.lastUpdate`(毫秒时间戳,0/缺失表示不显示)
- Produces: 与 web 端一致的四档时间文本规则

- [ ] **Step 1: 修改 `timeAgo` computed**

把 [provider-card.ux:55-61](../../../src/components/provider-card.ux) 的:

```js
    timeAgo: function () {
      if (!this.result.lastUpdate) return ''
      const diff = Date.now() - this.result.lastUpdate
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
      return Math.floor(diff / 3600000) + '小时前'
    },
```

替换为:

```js
    timeAgo: function () {
      if (!this.result.lastUpdate) return ''
      const diff = Date.now() - this.result.lastUpdate
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
      return Math.floor(diff / 86400000) + '天前'
    },
```

(仅新增倒数第二行 `if (diff < 86400000) ...` 与把原 return 行改为 `Math.floor(diff / 86400000) + '天前'`。)

- [ ] **Step 2: 验证**

改动为单行纯函数逻辑,无小米调试器环境时以代码审查级验证即可(diff 确认仅此一处)。有调试器时:`npm start` + 快应用调试器扫码,刷新一家供应商,确认时间文本正常显示(超 24h 快照场景显示"X天前")。

- [ ] **Step 3: 提交**

```bash
git add src/components/provider-card.ux
git commit -m "✨ feat: 快应用端timeAgo补\"X天前\"档位,与web端规则对齐"
```
