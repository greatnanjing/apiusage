# 多实例供应商 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持同一供应商添加多个实例（不同账号/key），自定义名称/URL/KEY/账户，全本地存储，web + 快应用双端同步。

**Architecture:** provider 加 `uid`（实例唯一）+ `tid`（模板类型）。所有「找供应商」用 uid，模板类型判断（zhipu/sensenova 特殊查询）用 tid。商汤 `account`(手机号)+`apiKey`(PIN)，querySenseNovaUsage 拼成 `account|apiKey` 自动登录。全本地 localStorage/storage。

**Tech Stack:** web 单文件 JS（`web/index.html`）+ 快应用 ES module/.ux（`src/`）。无单测框架，用 playwright（浏览器）+ curl + `hap build` 验证。

## Global Constraints

- 敏感数据（apiKey/account/PIN/endpoint）**只存 localStorage / @system.storage**，不入服务器
- 双端（web + 快应用）功能对等，模板字段、请求头、解析逻辑一致
- 旧数据迁移：provider 无 `uid/tid` → `uid=id, tid=id, account=''`
- 商汤 `account` 字段仅 `tid==='sensenova'` 显示，其他供应商隐藏
- web 端商汤自动登录仍需 server.js 代理（`/api/sensenova/login`），快应用直连
- 改 web 只动 `web/index.html`；改快应用动 `src/common/*.js` + `src/pages/index/index.ux`

---

### Task 1: web — provider 加 uid/tid/account + load() 旧数据迁移

**Files:**
- Modify: `web/index.html` `load()`（约 259-262 行）

**Interfaces:**
- Produces: provider 对象含 `uid`/`tid`/`account` 字段；`load()` 自动迁移旧数据

- [ ] **Step 1: 改 load() 加迁移**

替换 `load()` 函数为：

```js
function load() {
  try { providers = JSON.parse(localStorage.getItem('apiusage_providers') || '[]') } catch(e) { providers = [] }
  try { cards = JSON.parse(localStorage.getItem('apiusage_cards') || '[]') } catch(e) { cards = [] }
  // 旧数据迁移：无 uid/tid → uid=id, tid=id, account=''
  for (var i = 0; i < providers.length; i++) {
    var p = providers[i]
    if (!p.uid) { p.uid = p.id || ('p_' + Date.now() + '_' + i); p.tid = p.id || p.uid }
    else if (!p.tid) p.tid = p.id || p.uid
    if (p.account === undefined) p.account = ''
    p.id = p.uid  // 兼容现有代码用 p.id
  }
  for (var j = 0; j < cards.length; j++) {
    if (!cards[j].uid) cards[j].uid = cards[j].id
    cards[j].id = cards[j].uid
  }
}
```

- [ ] **Step 2: 浏览器验证迁移**

启动 `node web/server.js`，playwright navigate `http://localhost:3456/`，eval 注入旧 provider（无 uid/tid）后 reload，确认 `providers[0].uid`/`.tid`/`.account` 生成：

```js
// eval：先塞旧数据
localStorage.setItem('apiusage_providers', JSON.stringify([{id:'deepseek',name:'DeepSeek',apiKey:'sk-x',endpoint:'https://api.deepseek.com/user/balance',method:'GET',authType:'bearer',responseMapping:{balancePath:'balance_infos[0].total_balance'}}]))
location.reload()
// reload 后
JSON.stringify(providers[0])  // 应含 uid/tid/account
```

- [ ] **Step 3: commit**

```bash
git add web/index.html && git commit -m "feat(web): provider 加 uid/tid/account + 旧数据迁移"
```

---

### Task 2: web — openAdd/confirmAdd 多实例 + 四字段输入

**Files:**
- Modify: `web/index.html` `openAdd()`（约 586-604）、`confirmAdd()`（约 622-650）

**Interfaces:**
- Consumes: `TEMPLATES`（不变）
- Produces: providers 可含多个同 tid 实例（不同 uid）

- [ ] **Step 1: 改 openAdd() — 可重复勾选 + 四字段输入**

替换 `openAdd()` 函数体（`document.getElementById('addScroll').innerHTML = ...` 部分）为：

```js
function openAdd() {
  // 不再排除已添加，允许同模板多实例
  document.getElementById('addScroll').innerHTML = TEMPLATES.map(function(t) {
    return '<div class="add-item" id="aitem-' + t.id + '">' +
      '<div class="add-item-row" onclick="toggleCheck(\'' + t.id + '\')">' +
        '<div class="cb" id="cb-' + t.id + '"></div>' +
        '<span class="add-item-name">' + esc(t.name) + '</span>' +
      '</div>' +
      '<div class="add-key-area" id="keyarea-' + t.id + '">' +
        '<input id="name-' + t.id + '" placeholder="名称（默认' + esc(t.name) + '）">' +
        '<input id="endpoint-' + t.id + '" placeholder="API 地址" value="' + esc(t.endpoint) + '">' +
        '<input id="key-' + t.id + '" placeholder="' + (t.id === 'sensenova' ? 'PIN 或 access_token' : 'API KEY') + '">' +
        (t.id === 'sensenova' ? '<input id="account-' + t.id + '" placeholder="账户（手机号，自动登录）"><div class="add-key-hint">填手机号+PIN 自动登录；或只填 access_token 手动</div>' : '') +
      '</div></div>'
  }).join('')
  document.getElementById('addModal').classList.remove('hidden')
}
```

- [ ] **Step 2: 改 confirmAdd() — 读四字段 + 生成 uid**

替换 `confirmAdd()` 为：

```js
function confirmAdd() {
  var checked = document.querySelectorAll('.add-scroll .cb.checked')
  if (!checked.length) { alert('请至少选择一个供应商'); return }
  var added = false
  checked.forEach(function(cb) {
    var tid = cb.id.replace('cb-', '')
    var keyInput = document.getElementById('key-' + tid)
    var key = keyInput ? keyInput.value.trim() : ''
    if (!key) { alert('请填写 KEY/PIN'); return }
    var tpl = TEMPLATES.find(function(t) { return t.id === tid })
    if (!tpl) return
    var name = (document.getElementById('name-' + tid) || {}).value || (document.getElementById('name-' + tid) ? '' : '') || tpl.name
    var nameInput = document.getElementById('name-' + tid)
    var nameVal = nameInput ? nameInput.value.trim() : ''
    var copy = JSON.parse(JSON.stringify(tpl))
    copy.uid = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    copy.tid = tid
    copy.name = nameVal || tpl.name
    copy.endpoint = (document.getElementById('endpoint-' + tid) || {}).value.trim() || tpl.endpoint
    copy.apiKey = key
    copy.account = (document.getElementById('account-' + tid) || {}).value ? document.getElementById('account-' + tid).value.trim() : ''
    copy.id = copy.uid
    // 清除模板的 apiKey 空（模板里是 ''，保留）
    providers.push(copy)
    added = true
  })
  if (added) { save(); closePanel('addModal'); refreshAll() }
}
```

- [ ] **Step 3: 浏览器验证多实例**

playwright：添加两个 DeepSeek（不同 name/apiKey），确认 `providers` 有两条 tid='deepseek'：

```js
// eval openAdd → 勾 deepseek → 填 name="DS主"、key="sk-1" → 确认 → 再 openAdd 勾 deepseek → name="DS副"、key="sk-2" → 确认
providers.filter(p=>p.tid==='deepseek').length  // 应 2
```

- [ ] **Step 4: commit**

```bash
git add web/index.html && git commit -m "feat(web): 添加多实例 + name/endpoint/key/account 四字段"
```

---

### Task 3: web — editOne 按 uid + 四字段 + 商汤特殊

**Files:**
- Modify: `web/index.html` `editOne()`（约 818-838）

- [ ] **Step 1: 改 editOne() — 按 uid + account 字段**

替换 `editOne()` 为：

```js
function editOne(uid) {
  var p = findProv(uid); if (!p) return
  editProvId = uid
  document.getElementById('editTitle').textContent = '编辑 ' + p.name
  document.getElementById('editNameInput').value = p.name || ''
  document.getElementById('editEndpointInput').value = p.endpoint || ''
  var keyInput = document.getElementById('editKeyInput')
  keyInput.value = p.apiKey || ''
  keyInput.placeholder = (p.tid === 'sensenova' ? 'PIN 或 access_token' : 'sk-...')
  // account 字段（仅商汤显示）
  var accLabel = document.getElementById('editAccountLabel')
  var accInput = document.getElementById('editAccountInput')
  var showAcc = (p.tid === 'sensenova')
  if (accLabel) accLabel.style.display = showAcc ? 'block' : 'none'
  if (accInput) { accInput.style.display = showAcc ? 'block' : 'none'; accInput.value = p.account || '' }
  // endpoint 字段：商汤隐藏（查询走硬编码 URL）
  var epLabel = document.querySelector('label[for="editEndpointInput"]')
  var epInput = document.getElementById('editEndpointInput')
  var hideEp = (p.tid === 'sensenova')
  if (epLabel) epLabel.style.display = hideEp ? 'none' : 'block'
  epInput.style.display = hideEp ? 'none' : 'block'
  document.getElementById('editKeyHint').style.display = hideEp ? 'block' : 'none'
  document.getElementById('editModal').classList.remove('hidden')
}
```

- [ ] **Step 2: 加 editAccount HTML**

在 `web/index.html` 编辑弹窗的 `editKeyHint` div 后、`editSecretLabel` 前加：

```html
<label class="edit-label" for="editAccountInput" id="editAccountLabel" style="display:none">账户（手机号，仅商汤）</label>
<input id="editAccountInput" placeholder="手机号" style="display:none">
```

- [ ] **Step 3: 改 saveEdit() — 保存 account**

在 `saveEdit()`（约 817-829）的 `p.apiKey = ...` 后加：

```js
  p.account = (document.getElementById('editAccountInput') || {}).value ? document.getElementById('editAccountInput').value.trim() : (p.account || '')
```

并把 `saveEdit` 里的 `editProvId` 当 uid 用（`findProv(editProvId)` 已按 id=uid 找）。

- [ ] **Step 4: 浏览器验证编辑**

playwright 编辑商汤实例，确认 account 字段显示、endpoint 隐藏；编辑 DeepSeek 确认 account 隐藏、endpoint 显示。

- [ ] **Step 5: commit**

```bash
git add web/index.html && git commit -m "feat(web): editOne 按 uid + account 字段（商汤）"
```

---

### Task 4: web — refreshAll/refreshOne 用 uid + tid 判类型

**Files:**
- Modify: `web/index.html` `refreshAll()`（约 445）、`refreshOne()`（约 482）、`buildCard()`（约 554）、`refreshOne` 里 `id === 'sensenova'` 判断

**Interfaces:**
- Consumes: provider.uid/tid
- Produces: 多实例刷新，按 tid 触发特殊查询

- [ ] **Step 1: refreshAll 改 uid + tid**

`refreshAll()` 里 `active.map` 段改：

```js
  var promises = active.map(function(p) {
    if (p.tid === 'sensenova') {
      return Promise.resolve({ id:p.uid, name:p.name, status:'unknown', statusLabel:STATUS_MAP['unknown'], balanceText:'—', extraRows:[], sensenovaModels: existingModels(p.uid), lastUpdate:Date.now() })
    }
    return callApi(p).then(function(data) { return buildCard(p, data) })
      .catch(function(e) { return { id:p.uid, name:p.name, status:'error', statusLabel:'错误', balanceText:e.message||'失败', extraRows:[], lastUpdate:Date.now() } })
  })
```

智谱/商汤并行查询段改 `cards[i].tid`：

```js
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].tid === 'zhipu') cpPromises.push(queryZhipuCodingPlan(cards[i]))
      if (cards[i].tid === 'sensenova') cpPromises.push(querySenseNovaUsage(cards[i]))
    }
```

注意 buildCard 返回的 card 要含 `tid`（见 Step 2）。

- [ ] **Step 2: buildCard 加 tid + uid**

`buildCard(prov, raw)` 返回对象加 `tid: prov.tid, uid: prov.uid`，且 `existingSn` 查找按 `uid`：

```js
function buildCard(prov, raw) {
  // ... 现有解析 ...
  var existingCard = cards.find(function(c) { return c.uid === prov.uid })
  var existingCp = existingCard ? existingCard.codingPlan : null
  var existingSn = existingCard ? existingCard.sensenovaModels : null
  return { id:prov.uid, uid:prov.uid, tid:prov.tid, name:prov.name, status:status, statusLabel:STATUS_MAP[status], balanceText:display, extraRows:rows, lastUpdate:Date.now(), codingPlan: existingCp, sensenovaModels: existingSn }
}
```

helper `existingModels(uid)` 查已有 sensenovaModels：

```js
function existingModels(uid) { var c = cards.find(function(x){return x.uid===uid}); return c ? (c.sensenovaModels||[]) : [] }
```

- [ ] **Step 3: refreshOne 改 uid + tid**

`refreshOne(uid)` 里 `id` 全改 `uid`，`id === 'sensenova'`/`'zhipu'` 改 `p.tid === ...`：

```js
function refreshOne(uid) {
  var p = findProv(uid); if (!p) return
  if (p.tid === 'sensenova') {
    var snCard = { id:uid, uid:uid, tid:'sensenova', name:p.name, status:'unknown', statusLabel:STATUS_MAP['unknown'], balanceText:'—', extraRows:[], sensenovaModels: existingModels(uid), lastUpdate:Date.now() }
    for (var i = 0; i < cards.length; i++) { if (cards[i].uid === uid) { cards.splice(i, 1, snCard); break } }
    save(); renderAll()
    querySenseNovaUsage(snCard).then(function() { save(); renderAll() })
    return
  }
  callApi(p).then(function(data) {
    var card = buildCard(p, data)
    for (var i = 0; i < cards.length; i++) { if (cards[i].uid === uid) { cards.splice(i, 1, card); break } }
    save(); renderAll()
    if (p.tid === 'zhipu') queryZhipuCodingPlan(card).then(function() { save(); renderAll() })
  }).catch(function(e) { alert('刷新失败: ' + e.message) })
}
```

- [ ] **Step 4: renderAll 拖拽/查找按 uid**

`renderAll` 里 `data-id` 用 `c.uid`，`onclick` 传 `c.uid`。`refreshOne`/`editOne`/`deleteOne` 按钮调用传 uid。`onDrop`/`applyCardOrder` 按 uid（已是 `c.id`=uid）。

- [ ] **Step 5: deleteOne 改 uid**

`deleteOne(uid)`：`var p = findProv(uid)`，`cards = cards.filter(c => c.uid !== uid)`。

- [ ] **Step 6: 浏览器验证多实例刷新**

playwright 添加两个 DeepSeek（不同 key），refreshAll，确认两个卡片各自刷新（一个 401 一个 200，或都显示余额）。

- [ ] **Step 7: commit**

```bash
git add web/index.html && git commit -m "feat(web): refreshAll/refreshOne/buildCard 用 uid+tid 支持多实例"
```

---

### Task 5: web — querySenseNovaUsage 按 tid + account 自动登录

**Files:**
- Modify: `web/index.html` `querySenseNovaUsage()`（约 589）

- [ ] **Step 1: 改 querySenseNovaUsage — 按 tid 找 + account 拼接**

`querySenseNovaUsage(card)` 开头改：

```js
function querySenseNovaUsage(card) {
  var p = findProv(card.uid || card.id)  // 按 uid 找
  if (!p || !p.apiKey || !p.apiKey.trim()) return Promise.resolve()
  // account 有值 → 自动登录（拼 account|apiKey 即 手机号|PIN）；否则 apiKey 当 token
  var isAuto = !!(p.account && p.account.trim())
  var key = isAuto ? (p.account.trim() + '|' + p.apiKey.trim()) : p.apiKey.trim()
  // 后续逻辑同现状：isAuto → /api/sensenova/login；else → decodeJwtTenantId
  // （复用现有 querySenseNovaUsage 的 isAuto 分支，key 即原 apiKey）
  ...
}
```

实际上现有 `querySenseNovaUsage` 已按 `key.indexOf('|')` 判 isAuto。现在 key = isAuto ? `account|apiKey` : apiKey，逻辑一致。把 `var key = p.apiKey.trim()` 改成上面两行即可，其余不变。

- [ ] **Step 2: 浏览器验证商汤 account 自动登录**

playwright 添加商汤，account=17895093919、apiKey=abc666BC;，refreshAll，确认卡片显示「5 个模型·最低 X%」（自动登录拼 17895093919|abc666BC;）。

- [ ] **Step 3: commit**

```bash
git add web/index.html && git commit -m "feat(web): querySenseNovaUsage 按 account 拼手机号|PIN 自动登录"
```

---

### Task 6: web — 综合验证 + 提交

- [ ] **Step 1: 多实例 + 编辑 + 删除 综合验证**

playwright：添加两个商汤（不同 account/PIN）、两个 DeepSeek，刷新，编辑其中一个改名，删除一个，确认列表正确、余量条各自显示。

- [ ] **Step 2: 旧数据迁移验证**

localStorage 塞旧格式 provider（id 无 uid/tid），reload，确认迁移 + 仍能刷新。

- [ ] **Step 3: 部署到 47.103.128.255 验证**

tar 打包 web/ 上传服务器，pm2 restart apiusage，访问 https://47.103.128.255/apiusage/ 测多实例商汤（需 server.js 代理自动登录）。

- [ ] **Step 4: commit + push**

```bash
git add web/index.html && git commit -m "test(web): 多实例综合验证通过" && git push origin main
```

---

### Task 7: 快应用 — providers.js 不变 + api.js 加 account 参数

**Files:**
- Modify: `src/common/api.js` `fetchSenseNovaUsage(apiKey)` → `fetchSenseNovaUsage(account, apiKey)`

- [ ] **Step 1: fetchSenseNovaUsage 支持 account**

```js
export function fetchSenseNovaUsage(account, apiKey) {
  const token = (apiKey || '').trim()
  const acc = (account || '').trim()
  const isAuto = !!acc
  const key = isAuto ? (acc + '|' + token) : token
  const tenantId = isAuto ? null : decodeJwtTenantId(key)
  if (!isAuto && !tenantId) return Promise.reject(new Error('token 格式无效'))
  // isAuto → 走 server.js /api/sensenova/login（快应用无 server.js，自动登录不可用！）
  // 故快应用端 isAuto 时报错提示「快应用不支持自动登录，请填 access_token」
  if (isAuto) return Promise.reject(new Error('快应用不支持自动登录，请填 access_token'))
  // 手动 token 模式（同现状）
  return snFetch(SENSENOVA_MODELS_URL, token).then(function (mj) {
    ...
  })
}
```

注意：快应用无 server.js，`/api/sensenova/login` 不可用，故快应用端商汤**只支持手动 token**（account 必须空）。spec 已记。

- [ ] **Step 2: commit**

```bash
git add src/common/api.js && git commit -m "feat(src): fetchSenseNovaUsage account 参数（快应用仅手动 token）"
```

---

### Task 8: 快应用 — index.ux 多实例 + 四字段

**Files:**
- Modify: `src/pages/index/index.ux`（openAdd/confirmAdd/editOne/refreshAll/refreshOne/_buildCard/_querySenseNovaUsage）

- [ ] **Step 1: openAdd/confirmAdd 多实例 + 四字段**

参照 web Task 2，`index.ux` 的添加弹窗加 name/endpoint/account 输入框（商汤显示 account），confirmAdd 生成 uid。`.ux` 模板用 `<input>` + `{{ }}` 绑定。

- [ ] **Step 2: editOne/refreshAll/refreshOne/_buildCard 用 uid+tid**

参照 web Task 3/4，`index.ux` 的 `_buildCard`/`doRefreshAll`/`refreshOne`/`_queryZhipuCodingPlan`/`_querySenseNovaUsage` 改 uid+tid。

- [ ] **Step 3: _querySenseNovaUsage 传 account**

`_querySenseNovaUsage(card)` 调 `fetchSenseNovaUsage(p.account, p.apiKey)`（快应用 account 应空，手动 token）。

- [ ] **Step 4: load 迁移**

快应用 storage 加载处（`providers_config`）迁移旧 provider（无 uid/tid → uid=id, tid=id, account=''）。

- [ ] **Step 5: hap build 验证**

```bash
npm run build
```

确认编译通过（0 错误）。

- [ ] **Step 6: commit**

```bash
git add src/pages/index/index.ux && git commit -m "feat(src): index.ux 多实例 + uid/tid + 四字段"
```

---

### Task 9: 双端对等验证 + 提交

- [ ] **Step 1: 双端对照**

确认 web 和快应用的 TEMPLATES/PROVIDER_TEMPLATES、解析字段、请求头一致（CLAUDE.md 约束）。

- [ ] **Step 2: hap server 真机测试（用户）**

`npm start`，手机连，测多实例商汤（手动 token）+ DeepSeek。

- [ ] **Step 3: commit + push**

```bash
git push origin main
```

---

## Self-Review

1. **Spec coverage**: spec 的数据结构/添加/编辑/卡片/查询/存储/迁移/双端/不做 → Task 1-9 覆盖。✓
2. **Placeholder**: 无 TBD，每步有代码/命令。✓
3. **Type consistency**: uid/tid/account 在所有 task 一致；`findProv` 按 id=uid；`existingModels(uid)`。✓
4. **Gap**: spec 说"商汤 account 仅 sensenova 显示"→ Task 2/3 实现。✓

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-multi-instance.md`.
