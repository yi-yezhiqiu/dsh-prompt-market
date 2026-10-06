# UI-DESIGN-01 · t4 客户端界面设计契约（uismith）

> 状态：**等待期只读准备产物**。t4 尚未领取（`claim_task(t4)` → blocked by t3）。本文件是设计契约，
> 不含运行时代码；`client.js` 只在 t4 一次性完整装配，**中途不留能被下次启动加载的半成品**。
> 依据：`docs/CONSTRAINTS-01 §C.1/§D/§E`、`docs/CONTRACTS-01 · t-ui`、`docs/DSH-01 §2/§3/§5`、`docs/DATA-01-数据层接口.md`、
> `core/api.js`（现成接口面）、`docs/USER-ACCEPT-01-用户实测步骤.md`、`docs/USER-ACCEPT-02-实测结果判定.md`（verifier 的 E-7/E-9/E-10、F-1/F-2/F-3）、
> 队长第 3–5 轮裁决与 verifier 的探针/BOM 反馈（setDraft 结论未定；insertText 主通道理由=可撤销；「替换」为条件动作；`replace` 不进取值域；
> 否定性断言纪律；面向用户命令须标注「未实测」）。
> 标注：🟩 有逐字证据 / 🟨 需运行时确认（t8 用户验收闸门）。

---

## 0. 装配与部署纪律（先读，安全相关）

> 🟥 **标记口径澄清（最显眼位置；评审与 verifier 必读）**
> `client.js` 里的 `/* PM-CORE-INLINE:BEGIN/END */`（数据层）与 `/* PM-UI-INLINE:BEGIN/END */`（UI 源码）是
> **我方自己在 `client.js` 里定义的装配锚点**，**只在 `client.js` 出现**；`core/browser.js` 里的是 datasmith 侧的
> 分段标记 `/* BEGIN inlined file: <name> */` … `/* END inlined file: <name> */`（**单行、顶格、无 `====` 装饰**；旧稿的装饰形态已作废）。
> **两者不是同一个东西**：不要去 `browser.js` 找 `PM-CORE-INLINE`（**找不到是正常的，不是缺陷**），
> 也不要用 `BEGIN/END inlined file` 去 `client.js` 里找锚点。**提取来源统一**为 `browser.js` 的 **9 个单元区**（见下）。
> 匹配请用**子串容错**（`BEGIN inlined file:`），**不要锚定装饰符或列位置**。
> （此裁决来自队长两轮确认：保留 `PM-CORE-INLINE` 命名不改名；澄清句必须保留且显著。）

| 项 | 规定 |
|---|---|
| 唯一运行时产物 | `client.js`（自包含 ModuleLoader bundle，手写；`require` 只取 `react`） |
| 数据层来源 | **装配方式 B（队长认可）**：把 `core/browser.js` 的 **9 个单元区**（`/* BEGIN inlined file: <name> */` … `/* END inlined file: <name> */`，子串容错匹配）的**单元体**整段**顶格**粘贴进 `client.js` 的 `PM-CORE-INLINE` 标记区。单元名：`constants.js` `text.js` `filter.js` `storage.js` `normalize.js` `net.js` `sources.js` `api.js` **`bootstrap`**（⚠️ `bootstrap` **无 `.js` 后缀**，解析勿写死 `\.js$`）。8 个数据单元以 `})(__pmCore);` 收尾，`bootstrap` 以 `})(typeof globalThis !== 'undefined' ? globalThis : this);` 收尾，都是**自带 IIFE 的完整语句**。**不**内联 UMD 外壳/head/tail。数据层命名空间落 `window.__pmCore`（由 `bootstrap` 单元挂载），UI 取 `__pmCore.getMarket()`（=`api.getShared({})`） |
| UI 源码权威副本 | `ui/*.js`（每单元独立成句，可分段内联）；`client.js` 的对应标记区是装配产物 |
| 内联位置 | `client.js` 内由**我方自己定义**的成对标记：数据层用 `/* PM-CORE-INLINE:BEGIN */ … /* PM-CORE-INLINE:END */`，UI 源码用 `/* PM-UI-INLINE:BEGIN */ … /* PM-UI-INLINE:END */`；两区都**顶格粘贴**（不加缩进），以便逐行比对。<br>⚠️ 这两个标记**只存在于 `client.js`**（是我方装配标记）；**不要**去 `browser.js` 找 `PM-CORE-INLINE`——那里只有 `BEGIN/END inlined file: <name>` |
| 分段安全 | 每个内联单元（= 每个核心文件 / 每个 `ui/*.js` 单元）自成**完整语句**（自带 IIFE），故逐个插入时**每一步 `client.js` 都是合法 JS** |
| 🟥 装配前置闸门（按**不变量**判定；实测依据：队长逐对核过行号 + `.linecount.txt §1`） | **唯一权威标记 = `BEGIN inlined file: <name>` / `END inlined file: <name>`**（子串容错匹配；t2 时代的 `PM-CORE-INLINE:BEGIN/END` 已作废，**不要再等它**）。判据 = **9 个单元区间全部存在、成对且各自闭合**：8 个数据单元体以 `})(__pmCore);` 收尾，`bootstrap` 以 `})(typeof globalThis !== 'undefined' ? globalThis : this);` 收尾。**九区齐全即可装配**。<br>实测行号（会漂移，仅作参考）：`constants.js` 52–535 · `text.js` 537–898 · `filter.js` 900–1213 · `storage.js` 1215–2146 · `normalize.js` 2148–2765 · `net.js` 2767–3246 · `sources.js` 3248–3698 · `api.js` 3700–4727 · `bootstrap` 4729–4843（全文件 4843 行）。<br>🟥 **一致性判据的权威来源是 `browser.js` 的标记区内容**（`client.js` 必须与之**逐行一致，去行首缩进/去空行后**）；**不要**与 `core/*.js` 核心源文件逐行比对——它们**语义同源但非 1:1**（单元体用更短的说明头，`storage` 有 2 处语义等价的紧凑写法；出处 `core/.linecount.txt §1` 末尾）。<br>🟥 不要把 UMD 外壳 / tail / `return { … }` 当判据（可能永不拼进 `browser.js`）。<br>🟥 缺任一区 ⇒ **停下来报队长**，绝不自行拼装、补齐或改动缺失部分 |
| 🟥 半成品禁令 | profile 是以 `link:<仓库路径>/plugin` 方式安装的（**已启用**）⇒ 改动**下次启动即生效**。装配期间若中断，`client.js` 必须仍**可加载**：数据层缺失时只降级成界面内的「数据层未内联」错误态，绝不白屏或抛错 |
| 免重装 | 改 `client.js` 后**不需重装**，重启桌面端即可；README/交付说明按此写 |

---

## 1. 落点与注册（验收 ① ②）

| 组件 | 槽位 | 说明 |
|---|---|---|
| 「提示词导入」按钮 | `conversation.input.left` | `ctx.slots.inject(slot, () => ctx.slots.register({name, id:'prompt-market-import-button', order:80}, Comp))`；必须带 `aria-label` + `title`；🟨 左槽位仅在有会话时渲染（asar:421070） |
| 市场面板 | `conversation.input.overlay` | 同一 bundle 内的第二个注册条目 `id:'prompt-market-panel'`；面板不遮挡编辑器与发送按钮 |
| 定位策略 | 面板 | 首选 `position:absolute; bottom:calc(100% + 8px); left:0; right:0`（相对 overlay 容器）；最大高度 `min(60vh, 520px)`；`max-width:720px`；🟨 若 overlay 容器非定位上下文，退化为 `position:fixed` + 居中，并在状态条注明 |
| 跨槽位状态 | 按钮 ↔ 面板 | 两个槽位是**两棵 React 树**，禁止用 context；用模块级 `createStore()`（闭包 + `subscribe`/`getState`/`setState` + `React.useSyncExternalStore` 不可用时的 `useEffect`+`useState` 兜底） |

---

## 2. 主题 token 映射（验收 ①；CONSTRAINTS §D 的 14 个）

颜色 **100%** 走 `var(--dsw-*)`，**禁止** hex / rgb / hsl / `var(--t, #fff)` 形式的硬编码兜底（静态脚本会断言）。
light/dark 两套由 DSH 主题自动切换，插件不自造两套值（正是「只用 token」的落地方式）。

| 用途 | token |
|---|---|
| 面板背景 | `--dsw-alias-bg-overlay` |
| 面板页签条 / 头部 / 分栏列 | `--dsw-specific-sidebar-fill` |
| 列表项、输入框、卡片 | `--dsw-alias-bg-layer-1` |
| 次级嵌套面（标签 chip、正文预览块） | `--dsw-alias-bg-layer-2` |
| 分隔线、卡片描边 | `--dsw-alias-border-l1` |
| 聚焦/选中描边、按钮描边、页签下划线 | `--dsw-alias-border-l2` |
| 主文本（标题、正文） | `--dsw-alias-label-primary` |
| 次文本（描述、计数、hint） | `--dsw-alias-label-secondary` |
| 主按钮底 / 选中页签 / 「插入」强调 | `--dsw-alias-brand-primary` |
| 成功态（`verified===true`、源连通、已收藏） | `--dsw-alias-state-success-primary` |
| 警告态（`verified===false`、过滤命中、只读/内存降级、缓存降级） | `--dsw-alias-state-warn-primary` |
| 错误态（拉取失败、写入被拒、解析失败、配额满） | `--dsw-alias-state-error-primary` |
| 非活动/禁用（置灰按钮、空态图标、`inputActions` 缺失） | `--dsw-alias-state-idle-primary` |
| 应用基础背景（仅在需要与宿主同底色的区域） | `--dsw-alias-bg-base` |

非颜色值（宽/高/间距/圆角/字号/`z-index`）用普通 px 常量，不受 token 约束。
CSS 落地顺序：`ctx.styles.insert(css)`（若该服务在本 lane 可用）→ 自建 `<style data-pm-style>` 注入 → 逐元素行内 style 兜底；
**所有 class 加 `pm_` 前缀**（遵守 asar:292610 作者规则：不 import 任何 `@deepseek-ai/*` 客户端包）。

---

## 3. 组件树（验收 ②④⑤⑥）

```
PmImportButton                     conversation.input.left
PmMarketPanel                      conversation.input.overlay
├─ PmBoundary                      类组件 componentDidCatch（任何渲染抛错 → 错误态而非白屏）
├─ PmHeader        标题 / 4 页签（市场·收藏·我的·源管理）/ 关闭
├─ PmToolbar       搜索框 + 分类(标签)筛选 + 排序(weight|title) + 刷新 + 每页条数
├─ PmStatusBar     后端(localStorage|memory) / readOnly / 降级 / 「过滤掉了 N 条」 / MIT 署名入口
├─ PmList          分页渲染（默认 60/页），空态/加载态/错误态三态齐备
│   └─ PmItemRow   标题 + 描述(中文库必显) + 标签 + 来源徽标 + 许可徽标 + ★收藏 + 「插入」/「追加」
├─ PmDetail        正文预览（纯文本，`textContent` 语义）+ 源 URL + 许可 + 打标签
├─ PmEditDialog    自建增删改（title 必填 + content 必填 + tags）
├─ PmSourcesPage   源列表（启用开关 / 连通性测试 / 缓存统计与清理 / 自定义源增删改 / 导入导出 / 高级：重置 + 写入诊断）
├─ PmFilterPanel   过滤开关（默认开）+ 动作模式（hide|mark）+ 逐规则启停 + 自定义屏蔽词
└─ PmLicenseNotice MIT 正文（逐字，来自 `licenses.notice()`）+ 各源署名 + 来源 URL
```

数据获取（按 DATA-01 的调用示例，全部经 §4 适配层）：
`market.init()` 一次 → `market.search({tab,q,page,pageSize})`；写操作后 `search` 重取当前页；
源管理用 `market.sources.*`；过滤用 `market.filter.*`；许可用 `market.licenses.*`；导入导出用 `market.data.*`。

---

## 4. 数据层适配层（单一入口，抗接口漂移）

`ui/adapter.js` 的职责：**UI 只认它的方法名**，DATA-01 若改签名只需改这一处。

| 适配方法 | 调用的数据层 | 返回给 UI |
|---|---|---|
| `init()` | `market.init()` | `{ok, readOnly, backend, durable, warnings, code, message}` |
| `list({tab,q,page,pageSize,force})` | `market.search(...)` | `{ok, items, total, page, pageSize, hasMore, filteredCount, errors[], degraded, sources}` |
| `toggleFav(item)` / `removeFav(uid)` | `market.fav.*` | `{ok, favorited?, code, message}` |
| `createCustom/updateCustom/removeCustom` | `market.custom.*` | `{ok, item?, code, message}` |
| `tagList/addTag/renameTag/removeTag/applyTags` | `market.tags.*` | `{ok, tags?, code, message}` |
| `sourceList/addSource/updateSource/removeSource/setEnabled/testSource/clearCache` | `market.sources.*` | `{ok, sources?, status?, code, message}` |
| `settingsGet/Update` / `filterGet/SetEnabled/SetActionMode/SetRuleEnabled/SetTerms` | `market.settings.*` / `market.filter.*` | `{ok, settings:{…, writeModes:[…]}}` —— 🟥 写入策略选项**必须**由 `settingsGet().settings.writeModes` 驱动（`core/api.js:694` 已返回该数组），**不得硬编码**；`filterGet()` 提供 `{settings, rules, enabled, actionMode}` |
| `licenseNotice/acknowledge` | `market.licenses.*` | `{ok, text, acknowledged}` |
| `exportJSON/importJSON/downloadExport/importFromFile` | `market.data.*` | `{ok, json?, fileName?, stats?, code, message}` |

🟥 **取数入口（DATA-01 §2.5.2/§2.5.3；`bootstrap` 是唯一写宿主全局的单元）**：`client.js` 内联完成后 `globalThis.__pmCore` 即数据层命名空间，
UI **走 bootstrap 的便捷方法**（不自己拼 `api.*`）：`getMarket()`（=`api.getShared({})`）、`initOnce()`、`listSources()`、`testSource(id)`（Promise）、
`addSource(...)`、`removeSource(id)`、`fetchPrompts(query)` / `search(query)`（Promise）、`favorites()`、`toggleFavorite(item)`、`myPrompts()`、
`createPrompt({title,content,tags})`、`filterInfo()`、`setFilterEnabled(bool)`、`notices()`、`exportJSON()`、`importJSON(text,{mode})`、
`settings()`（**含 `writeModes`**）、`updateSettings(patch)`、`diagnostics()`。
🟥 **数据层未就绪的错误态**：单元未加载全时 bootstrap **不抛错**，而是设 `globalThis.__pmCoreBrowserError = { ok:false, code:'E_BOOTSTRAP', message:'…' }`
⇒ UI **必须读这个全局**来显示「数据层未内联」错误态（**不要**自己猜原因、不要白屏）。
🟥 **持久化载体与键名（DATA-01 §2.5.4）**：`dsh-prompt-market:state`（权威根）/ `dsh-prompt-market:cache:<sourceId>` / `dsh-prompt-market:state:quarantine` / `dsh-prompt-market:state:probe`；
UI 义务：显示 `backendReport.kind` + `durable`；`store.status().readOnly===true` 时**禁止所有写入口**并提示原因；`warnings[]` 在「源管理/高级」可见。
🟥 **`search()` 字段（DATA-01 §2.5.5）**：`{ok, tab, q, page, pageSize, total, hasMore, items, filteredCount, filterStats{input,kept,dropped,flagged,filtered,actionMode}, errors[{sourceId?,code,message,degraded}], sources{<id>:{freshness,itemCount,filteredOut,fetchedAt,error}}, degraded}`；
**三源全断且无缓存时 `ok` 仍为 `true`、`total:0`、`items:[]`** ⇒ 必须渲染**空态**而不是错误态。

**错误态映射（验收 ⑥：不得白屏）** —— `constants.ERROR_CODES` → 中文文案 + token 色：

| code | 文案要点 | 色 |
|---|---|---|
| `E_NETWORK` / `E_TIMEOUT` / `E_HTTP` | 「网络不可达/超时/HTTP 错误」+「已展示本地缓存」 | warn |
| `E_RATE_LIMIT` | 「GitHub 匿名限流 60/h，稍后重试或填 token」 | warn |
| `E_PARSE` | 「上游结构变化，解析失败」+ 源 id | error |
| `E_SCHEMA` | 「数据版本高于本插件」+ 只读提示 | error |
| `E_STORAGE` / `E_QUOTA` | 「本地存储写入失败/配额已满」 | error |
| `E_BAD_INPUT` / `E_NOT_FOUND` / `E_UNSUPPORTED` | 就地行内提示，不打断列表 | idle/error |

规则：任何 `ok:false` 都渲染成**可见的错误条**并保留可交互的其它区域；`errors[]` 逐条列出（源 id + message + `showable`）；
`degraded===true` 或 `store.status().readOnly===true` 或 `backend==='memory'` 时**必须在状态条常驻提示**（内存后端＝本次会话不保留）。

---

## 5. 写入通道契约（验收 ③；队长两条纠正已固化）

```
主通道：  inputActions.insertText(text, captureInsertion())        // 当场捕获、当场插入，中间不得 await/setTimeout
备用：    inputActions.setDraft(text)                              // 仅在读回证明「确实没写进去」时才降级
成功判据：读回草稿 === 期望文本（writeAndVerify 的 verified === true）——返回值/未抛错都不算成功
```

- **主通道选 insertText 的理由（不是「setDraft 不可用」）**：`DSH-01 · req-9` 要求写入**可被 Ctrl+Z 撤销**；
  官方只对 `insertText` 规定 `undoable plain-text edit`（asar:403343 逐字），对 `setDraft` **无任何撤销承诺**。
  ⇒ 为满足 req-9，主通道必须是 `insertText`。
- 🟥 **`setDraft` 是否真能写入 = 未定论**（两个解释并存：(A) 没写进去；(B) 写了但我们的读回探针有缺陷）。
  UI 与注释一律不得写「setDraft 不可用」这类结论；只允许报告实测字段（见 §6）。
- **为什么不是 `setDraft` 优先（双保险理由，必须写进实现说明与 README）**：
  ① **主因（裁定级，无论如何都成立）**：`DSH-01 · req-9` 要求写入**可被 Ctrl+Z 撤销**，官方只对 `insertText` 承诺
     `undoable plain-text edit`（asar:403343 逐字），对 `setDraft` **无任何撤销承诺**；
  ② **支持性事实（不是主因）**：`setDraft` 的写入归因**尚未定论**（`CONSTRAINTS-01 §C.1` 已改为 🟨；严禁再写成「setDraft 不可用」）。
  🟥 两者性质不同：即使将来探针证明 `setDraft` 可用，**理由 ① 仍然成立**，主通道顺序不变；
  反之把 ② 当主因，一旦探针翻转理由就塌。故本契约把顺序**固定为 `insertText` 主 → `setDraft` 备**，
  并注明回归风险：`lib/write-draft.js` 的默认顺序是 `setDraft → insertText`，照它改回就会丢掉 req-9 的可撤销性。
- **`writeMode` 取值域（队长裁决；datasmith 已落地、verifier 已核）**：取值域只有 `insert`（光标处插入）与 `append`（追加、自动补空行）。
  **证据（「**代码存在**」级，非「已通过」级）**：`core/storage.js:273` `var WRITE_MODES = ['insert', 'append'];`、默认值 `:202`、
  脏值静默回落 `:279-284`；`core/api.js:701-712` 主动拒绝 `'replace'`；用例 `selftest-node.js:666-696`（**从未被执行**——队内无命令执行面）。
  🟥 **UI 硬要求**：写入策略选项**由 `settings.get().settings.writeModes` 驱动**（`core/api.js:694` 已返回该数组），**禁止硬编码** `['insert','append']`；
  界面**不得**出现 `replace` 选项（**连置灰项也不许**）。
  🟥 **判定纪律**：以上只是「代码存在」证据，**不是**「已通过」——我（及我方文档）**不得**写「自检通过」。
- 🟥 **UI 文案的措辞来源（verifier 指出）**：用户可见文案**只许**沿用 `core/api.js:710` 的**限定式**表述（「没有清空草稿/设置选区的能力」）；
  **不得**把 `core/storage.js:199-201` 那条绝对式注释（「没有可用实现路径」）抄成 UI 文案——它与「替换是条件动作」的裁决不一致。
- **「替换」是条件动作、不是设置项（队长补充裁决）**：界面**可以**提供一个「替换」动作，条件语义固定如下：
  1. 触发时先 `captureInsertion()` 捕获选区（**当场捕获、当场插入**，中间不得有 await）；
  2. 若捕获到的选区**覆盖草稿全部内容** ⇒ 如实呈现为「替换」并执行 `insertText(text, span)`；
  3. 若捕获不到选区、或选区不能覆盖全文 ⇒ **必须如实提示**「无法替换，请先按 Ctrl+A 全选草稿」（文案常量
     `PM_MSG_REPLACE_NEEDS_CTRL_A`），**不得静默退化成插入**让用户以为替换成功了。
     🟥 **该分支不得有任何写入调用——连 `setDraft` 都不许调**（最尴尬的组合是「提示无法替换 + 却把草稿写了/改了」）。
     实现形态：只有一个「提示 + console 记录 + `return {ok:false}`」的早退，整段用
     `/* PM-NO-WRITE:BEGIN */ … /* PM-NO-WRITE:END */` 包裹，供 `check-ui.ps1` 静态断言「该区不含 `insertText(` 与 `setDraft(`」；
  4. 🟥 **覆盖率判据 = 白名单 + 保守（队长强制要求；未经实测）**：`captureInsertion()` 的真实形状尚未取证（asar:417010 只逐字确认
     `...this.caretSpan(), revision:`）。规则逐条固定：
     - **字段白名单**：只接受 `from/to`、`start/end`、`anchor/head`、`selection`/`range`（嵌套时取嵌套内**同名键**）。
       **白名单之外一律不猜**——遇到非白名单形状 ⇒ `coversAll:"unknown"` ⇒ 走第 3 条拒绝分支。
     - 🟥 **显式排除 `revision`（及任何版本/时间戳语义字段）**：它已确证存在且**是数值字段但不是偏移量**
       （asar:417010 `...this.caretSpan(),` + 417011 `revision`；403343 `captures the draft selection and revision`）。
       若实现里出现「找两个数值字段」这类泛化，`revision` 会被当端点 ⇒ **轻则误拒绝，重则误判全选并真的执行部分替换（静默损坏用户草稿）**。
       该排除必须写成注释，防止后人泛化。
     - 🟥 **归一化规则写死**：`anchor/head` 是**无序对** ⇒ 先取 `min/max` 再判定（否则反向全选会被误判「不完整」而误拒绝）；
       归一后与 `[0, draft.length]` **精确相等**才算覆盖全文（**不得**用 `≥`、「长度接近」这类模糊判据）；**缺任一必需端点 ⇒ 不判覆盖**。
     - 🟥 **宁可拒绝，绝不猜**：任何不确定 ⇒ 拒绝分支 + 提示 `PM_MSG_REPLACE_NEEDS_CTRL_A` + **不写入**；此条**优先于**「让按钮可用」。
     - 解出的字段名与判定依据（归一后范围 + min/max）**原样回传**（`spanProbe.coversAllBasis` + console）——这是 verifier 校验算法的**唯一输入**。
     该分支的正确性由 §6 `spanProbe` 的实测输出在 t8 验证；在此之前标为**未实测**。
- 🟥 **草稿指纹日志（队长强制要求：把「一字不变」变成机器可判定的日志）**：凡走**拒绝分支**、以及**替换动作执行前后**，
  必须向 console 输出一行结构化判据（**只给长度与哈希，绝不给草稿内容**）：
  ```
  { beforeLength, afterLength, beforeHash, afterHash, replaced, verified }
  ```
  —— 哈希用**已内联**的 `contentHash`/`fnv1a32`（`__pmCore.text`），**不得新增依赖**。
  **判定口径（verifier 据此判定；我必须在 UI 与日志里同时体现）**：
  - **拒绝分支正确** = `replaced===false` **且** `beforeLength===afterLength` **且** `beforeHash===afterHash`；
  - **替换动作正确** = `replaced===true` **且** `verified===true`；
  - 任一不符 ⇒ verifier 判**失败**（静默损坏用户草稿，**数据损坏级**）。
  ⚠️ **只给长度不够**：长度相同 ≠ 内容相同（`a↔b`、交换两字符都不变长度）⇒ `beforeHash/afterHash` 是这条判据的**必需项**。
  🟥 **替换路径的附加字段（verifier 5 条）**：`insertTextReturned: boolean|null` 与 `replaced: boolean` ——
  `insertText` 返回 **`false` 就是「没写入」**（asar:403343 的拒绝语义），**必须如实呈现**；
  `coversAll === "unknown"` 时**根本不应调用** `insertText`（此时 `insertTextReturned` 必须为 `null`）。
- 🟥 **跨产物冲突 F-8 的处置（verifier 发现，已报队长）**：既有产物仍写「`setDraft` 首选、`insertText` 降级」——
  `lib/write-draft.js:130-134`、`client.js:140-171`（**当前装的就是这份**）、`docs/DEVELOPMENT.md:23/30-36`、
  `docs/check-plugin.ps1:251`（把旧序固化成断言）。若面板照 README 走 `writeAndVerify`，主通道会**静默变回 `setDraft`**，
  req-9 的 Ctrl+Z 落空，且只有真机点一次才看得出来。处置（设计已定，实施在 t4）：
  ① **面板直接调 `insertText`** —— 用 **UI 侧自有写入 helper**（insertText 主 → setDraft 备 + 读回断言），**不调用** `write-draft.js` 的 `writeAndVerify`；
  ② `docs/DEVELOPMENT.md`（在 t4 的 `plugin/` 范围内，我会改）把「写入**一律**走 `lib/write-draft.js`」**收窄**为「t2 试验脚本专用；正式面板走 `client.js` 的 insertText 主通道」；
  ③ `docs/check-plugin.ps1:251`（**不在** t4 的 `plugin/` 范围）与 `lib/write-draft.js` 的旧序**请队长指派归属方同步**；我在 t4 报告显式登记该断言已过期，并由 `check-ui.ps1` 断言 7/16 覆盖新序；
  ④ 分工固定（队长裁决，供评审核对）：

     | 用途 | 顺序 |
     |---|---|
     | **产品面板插入 / 追加 / 替换** | **`insertText` 主通道**（当场 `captureInsertion()`，中间不得有 await） |
     | **探针 / 诊断** | `setDraft` 先试 + 读回判定（正是为了给 C2 归因） |

     `setDraft` **不再作为产品写入的降级首选**；`lib/write-draft.js` 的定位改为**仅探针/诊断**（我**不改它**，也不把它当产品依赖）。
     面板必须掌控三件事，故必须用自己的 helper：(a) 主通道是 `insertText`（req-9 的 Ctrl+Z）；(b) 与选区捕获 + 覆盖率判定协同；(c) 与 `PM-NO-WRITE` 拒绝分支 + 草稿指纹输出协同。
     🟥 **写入日志必须如实输出 `method`**（`'insertText'` / `'setDraft'`），**正常路径恒为 `'insertText'`**；verifier 按**实际调用路径**判定，console 出现 `method:'setDraft'` ⇒ 视为**未满足 req-9**。
- **能力边界的如实描述（不得越界表述）**：插件**无法主动**清空草稿或设置选区 —— `inputActions` 字面量逐行读完只有 4 个键：
  `captureInsertion`(417009) / `insertText`(417013) / `setDraft`(417018) / `pruneAttachments`(417025)（verifier E-10，
  见 `docs/USER-ACCEPT-02-实测结果判定.md §1.2`）。**但** `insertText` 是「在捕获选区插入」⇒ **用户自己 Ctrl+A 全选后，
  `insertText` 就等价于覆盖整段草稿**。界面**不得**出现任何「插件能主动清空/覆盖草稿」的表述；用户文案统一写成
  「插入会替换当前选区；整段替换请先 Ctrl+A 全选（若插件捕获不到选区，会如实提示而不是假装成功）」。
  🟥 **否定性断言纪律（全队基线）**：主张「`inputActions` 没有某能力」**必须靠逐字读完字面量**得出，
  **不得**靠「搜名字搜不到」。反例：asar 约 486908 行有 `clearDraft()`，属**另一模块**（`draftRoutes`/`sameRoutes` 的**配置**草稿）成员，
  **不是** `inputActions` 成员。
- 写入字段：`settings.writeField` = `description`（**默认**，中文说明，便于阅读与修改）| `prompt`（可选，正文可直接执行）；
  中文库条目列表**必须同时显示** title + description（DSH-01 §5.2 的坑）。
- 写入结果文案（🟥 修正 t2 的误导文案）：
  - `verified === true` → 「已写入（可 Ctrl+Z 撤销）」+ 成功色；
  - `verified === false` / `ok === false` → 「未确认：写入未被读回证实」+ 警告色 + **原样**给出 `method / verified / rejectedAt / reason`（verifier 取证用）；
  - 替换动作的第 3 条分支（无法替换）→ 警告色提示 `PM_MSG_REPLACE_NEEDS_CTRL_A`，且**本次不写入任何文本**；
  - 禁止出现「写入成功」而 `verified!==true` 的文案；禁止以函数返回值或不抛错当作成功。
- 防御：渲染时先 `inspectInputActions(props.inputActions)`；为 `undefined` 时按钮**置灰**并提示（asar:292610：抛错=槽位空白）。

---

## 6. 受控探针（队长追加要求 2：定论 setDraft）

放在「源管理 → 高级 → 写入诊断」区，独立按钮「受控探针：只调 setDraft」。目的是定论 `verified=false` 到底是
(A) `setDraft` 没写进去，还是 (B) 读回探针本身不可靠（队长纠正 + verifier 修订）。

前提与安全：
- **草稿非空时拒绝运行**（软链接安装下周启动即生效，探针不做任何破坏性清理），并在 UI 显示拒绝原因；报告中
  **只记长度不记内容**（`refused:true, draftLength:N`）——草稿是用户隐私，不得写入 console。
- 探针文本用可辨识常量 `PM_PROBE_SETDRAFT`，并输出其期望值与长度（便于发现被 trim 或被改写）。
- 拒绝路径复用 §5 的**同一指纹 helper**（`beforeLength/beforeHash`，只记长度与哈希不记内容），与 `refused:true, draftLength:N` 一起输出，保持两处口径一致。

步骤（**当场捕获、全程不跨 await 复用 span**）：`before = readDraft()` → 读一个只读的 `captureInsertion()`（拿 revision 信号）
→ **只调** `setDraft(expected)`（本次**不**调 `insertText`）→ 同步 / 微任务 / 宏任务三个点各读回一次。

输出（页面可见一行 + console 原样 JSON；全部为原始值，另给**三元**判定）：

```js
setDraftAlone: {
  called, before, expected, expectedLength,
  readBackNow, readBackMicro, readBackAsync,     // 同 tick / 微任务(Promise.resolve().then) / 宏任务(setTimeout 0)
  matched, matchedMicro, matchedAsync,           // === expected
  readBackError,                                 // 读回抛错或返回 undefined 的原始信息
  readMethod,                                    // 'useInput(s=>s).draft' | 'useInput-threw' | 'no-useInput' | …
  inputStateKeys,                                // 快照对象的键（判断 draft 是否真在快照里）
  spanProbe: {
    kind, keys, revisionType, revisionText, captureError,
    fields: [ {k:'from', t:'number', n:0},
              {k:'to',   t:'number', n:12},
              {k:'revision', t:'number', n:37},
              {k:'<文本字段>', t:'string', len:12} ],   // 逐字段转换；失败 ⇒ t:'unconvertible'
    revisionPresent, excludedKeys, whitelistMiss,   // 排除是否生效 / 被排除的键 / 见过但既不在白名单也未排除的键
    endpointKeysUsed,                               // 实际用于判定的两个端点键名（与 excludedKeys 分开记）
    draftLengthAtCapture, noAwaitBetween,           // 捕获时的草稿长度 + 捕获到判定之间无 await（保证同 tick 比对）
    draftLength, selectionLength,        // 只记长度，不记内容
    coversAll,                           // true | false | "unknown"（由 §5 白名单逻辑在 probe 内先算一次）
    coversAllBasis                       // 判定依据：解出的字段名 + 归一后范围（min/max），原样回传
  },
  writeReturn,                                   // setDraft 返回值与 typeof（记录事实，不当判据）
  conclusion                                     // 'written' | 'not-written' | 'readback-unreliable'
}
```

- 🟥 **`spanProbe` 的 5 个可判定性字段（verifier 建议，全部采纳）**：
  `revisionPresent` + `excludedKeys`（`revisionPresent===true` 且 `excludedKeys` 含 `revision` ⇒ 排除生效，**并证明「若不排除就会误判」的字段真实存在**；
  若 `revisionPresent===false` 则**与 asar:417010-417011 冲突**（`revision` 就在返回对象里）⇒ 说明取的 `keys` 不是那个对象，verifier 需复核原始值——这是**能自证的矛盾**，比「没排除」更值得查）；
  `endpointKeysUsed`（实际用于判定的两个端点键名，与 `excludedKeys` 分开记，否则无法区分「用了白名单键」还是「用别的键凑出同样范围」）；
  `draftLengthAtCapture` + `noAwaitBetween`（覆盖率 = span 端点 vs `draft.length`，两者**必须在同一 tick**，否则比对本身不一致；`insertText` 的 revision 校验是第二道防线，**不能替代**这条）；
  `whitelistMiss`（见过但既不在白名单也未排除的键，用来证明「**不猜**」这条规则真的在跑）。

**判定必须是三元，不许二元**（verifier 要求）：
- `inputStateKeys` 里**没有 `draft`**，或 `readBackError` 有值 ⇒ `conclusion='readback-unreliable'`：
  **`matched=false` 绝不能推出「setDraft 没写」**；
- 读回可靠且任一读回点命中 `expected` ⇒ `conclusion='written'`（解释 (A) 被否，原 `verified=false` 属探针缺陷 (B)）；
- 读回可靠且三个读回点全不命中 ⇒ `conclusion='not-written'`（支持 (A)）。
- 只做 3 个读回点（1 同步 + 1 微任务 + 1 宏任务），**不加 4 次重试**（过度设计，且会掩盖真实时序问题）。
- `spanProbe` 的用途有三：① 给「草稿是否真的变了」提供比文本读回更硬的信号（`revision` 是官方判据，asar:417010/403343）；
  ② 为 §5 的条件「替换」动作提供**实测的选区字段形状**（用于改进/校验自适配提取；取得之前，自适配解出完整范围就执行、解不出就如实拒绝并提示 Ctrl+A）；
  ③ **一次收掉「字段名与取值」这个未知**（队长追加要求）。
- 🟥 **`spanProbe.fields` 采集规则（队长强制 + verifier 建议，隐私优先）**：`captureInsertion()` 的顶层形状 = `{...caretSpan(), revision}`（asar:417010 逐字），
  但 `caretSpan()` 的**字段名与取值至今未逐字取证**（asar:417264-265 只到 `caretSpan() { return this.draftEditor.caretSpan(); }`）⇒ 只能靠实测收掉。
  采集规则：
  - 逐字段转换：`{ k: 字段名, t: 类型, n: 数值（仅 number/boolean）, len: 长度（仅 string） }`；
  - 🟥 **字符串字段只给长度 `len`，绝不得把用户选中的文本 dump 进 console**（隐私）；仅 `revision` 例外，可给 `revisionText`；
  - 每个字段的转换都要 try/catch：`String(Symbol())` 会抛、对象只会得到 `[object Object]` ⇒ 失败记 `t:'unconvertible'`，
    **绝不能让整份报告丢失**（t2 的 R-3 教训：序列化失败不等于结论丢失）；
  - 输出 `draftLength` 与解出选区的 `selectionLength`；不输出草稿全文与选区文本；
  - 聚合判据 `coversAll` ∈ `true | false | "unknown"` 与判定依据 `coversAllBasis`（字段名 + 归一后 min/max），由 §5 的白名单逻辑在 probe 内先算一次。
- 🟥 **为什么必须给值而不只是键名**：覆盖率取决于**值**，不是名字。只给 `keys` 时 verifier 只能判「字段名写法正确」，
  **判不了「覆盖率判据正确」**——这与「归因 vs 事实」是同一类错误。若不采纳 `fields`，verifier 的判定口径将是
  「字段名写法正确、**算法正确性未判**」（队长认可该口径），所以必须采纳。
  ⇒ 目的：用户**一次实测**即可回答「该适配哪种字段形状」与「Ctrl+A 全选能否被识别为覆盖全文」，使白名单实现在下一次迭代**直接实现并复测**。

---

## 7. 静态自检脚本（验收 ⑥ 交付物；队长追加要求 3）

文件：`docs/check-ui.ps1`（**Windows PowerShell 5.1 可跑**，本机无 pwsh）。

用法（文档与脚本头部注释都必须写这条，禁止只写 `pwsh`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "ui\check-ui.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "ui\check-ui.ps1" -Json
# 退出码：0 = 全部通过；1 = 有失败项（逐条列出文件:行号）
```

断言清单（全部**无需 JS 运行时**）：

1. **区对区**比对（提取来源 = `core/browser.js` 的 **9 个** `BEGIN inlined file: <name>` … `END inlined file: <name>` 区间，**子串容错匹配**、不锚定装饰符/列位、单元名不写死 `\.js$`）：断言 `client.js` 的 `PM-CORE-INLINE` 区**内部**包含 9 个同名、逐行一致（去行首缩进/去空行后）、顺序一致的单元区；任一行不一致 ⇒ FAIL 并给出**首个不一致的行号**。**失败原因必须区分并给不同提示**（队长要求，避免排障变慢）：
   - 「`client.js` 里找不到 `PM-CORE-INLINE` 标记」⇒ 「client.js 装配未开始」；
   - 「标记在，但某单元区缺失 / 未闭合（8 个数据单元未以 `})(__pmCore);` 收尾、`bootstrap` 未以 `})(typeof globalThis !== 'undefined' ? globalThis : this);` 收尾）」⇒ 「t3 未完成（缺单元 X）」；
   - 「9 区都在但内容与 `browser.js` 不一致」⇒ 「内联过期（首个不一致行号 N）」。
   ⚠️ **不要**把「与 `core/*.js` 核心源文件不一致」判为失败——两者**语义同源但非逐行 1:1**（`.linecount.txt §1`）；`PM-CORE-INLINE` 只作 `client.js` 侧锚点，**不作为 `browser.js` 侧标记**使用；
2. `PM-UI-INLINE` 区内容与各 `ui/*.js` 单元一致；
3. 颜色：`client.js` 的 UI 区内出现 `#hex` / `rgb(` / `rgba(` / `hsl(` / `var(--t, …兜底)` 即失败；`var(--…)` 的参数必须落在 §D 的 14 个 token 白名单内；
4. 硬规则：不出现 `raw.githubusercontent.com`；不出现 `import`/`export` 语句；不出现 JSX（`React.createElement` 之外无 `<Tag`）；
5. `require(` 的参数集合 ⊆ `{react}`；
6. 槽位名与 id 存在：`conversation.input.left`、`conversation.input.overlay`、`prompt-market-import-button`、`prompt-market-panel`；
7. 写入契约：`insertText(` 出现在 `setDraft(` 之前；存在读回比对（`verified`）；不存在把返回值当成功的分支；
8. `writeMode` 的 `replace` **不出现在取值域**、也不作为设置项 UI 呈现；若存在「替换」动作，必须存在**如实拒绝路径**（静态断言：`PM_MSG_REPLACE_NEEDS_CTRL_A` 常量存在并被提示文案引用；分支逻辑由评审核对）；全文件不得出现「插件能主动清空/覆盖草稿」式表述；
9. 存在错误边界（`componentDidCatch`）与 `E_NETWORK` 等错误码文案映射；
10. MIT 署名与 `licenses.notice()` 调用存在；
11. 写入策略**不得硬编码**：`client.js` 中出现 `writeModes`（取自数据层 `settings.get()`），且**不出现**字面量 `['insert', 'append']` / `["insert", "append"]`；界面不出现 `replace` 选项；
12. 探针实现含 `spanProbe.fields`（每项 `{k,t,n?,len?}`；字符串只给长度；转换失败记 `t:'unconvertible'`）、`spanProbe.coversAll` 与 `spanProbe.coversAllBasis`；**不出现**把草稿全文或选区文本写入报告的代码路径；
13. 「替换」拒绝分支位于 `/* PM-NO-WRITE:BEGIN */ … /* PM-NO-WRITE:END */` 区内，且该区**不含** `insertText(` 与 `setDraft(`；白名单外的形状一律 `coversAll:"unknown"`（白名单集合与 `revision` 排除注释由评审核对）。（⚠️ 本条在 `client.js` 落地前**只是设计意图**，不计「已实现」；verifier 会在文件落地后 `grep PM-NO-WRITE` 并按行号对照该区内的写入调用）
14. **草稿指纹日志存在且字段齐全**：拒绝分支与替换动作前后均输出 `beforeLength` / `afterLength` / `beforeHash` / `afterHash` / `replaced` / `verified`（`replaced===false` 分支必须同时给出前后长度与前后哈希，否则「一字不变」无法机器判定）；
15. 数据层未就绪时读取 `__pmCoreBrowserError`（而非自造原因），错误态文案来源为 `code:'E_BOOTSTRAP'`；
16. **主通道防回归（F-8）**：`client.js` 的**面板写入路径**中 `insertText(` 出现在 `setDraft(` 之前，且**不出现**对 `writeAndVerify(` 的调用（防按 README 指引把主通道静默改回 `setDraft`）；写入日志含 `method` 字段，正常路径为 `'insertText'`；
17. **替换路径可判定性**：输出 `insertTextReturned` 与 `replaced`；`coversAll==="unknown"` 的分支内**不出现** `insertText(` 调用（此时 `insertTextReturned` 必须为 `null`）；`insertText` 返回 `false` 时 UI 文案必须如实报「未写入」。

脚本输出**必须分开**两段结论：`【静态已核对】` 与 `【运行时未实测】`（后者列出：按钮可见性、草稿是否入框、Ctrl+Z 是否可撤销、重启后持久化、断网降级 —— 均由 t8 用户验收闸门承接）。

编码与运行形态（**verifier 反馈已采纳**）：
- 🟥 `check-ui.ps1` 写成**纯 ASCII**（注释与输出用英文；中文说明放同名 `docs/check-ui.ps1.md`）。
  **自证判据（任何人可复核）**：`grep path="ui\check-ui.ps1" pattern="[^\x00-\x7F]"` ⇒ **期望 0 命中**；
  零命中 ⇒ 5.1「按 ANSI 解码无 BOM 的 .ps1」问题不存在，`-File` 直跑即可。
- 运行命令（5.1 合法形式）：`powershell -NoProfile -ExecutionPolicy Bypass -File "ui\check-ui.ps1"`
  （`-NoProfile` / `-ExecutionPolicy Bypass` / `-File` 均为合法参数）。
- 兜底（⚠️ **均为 verifier 语法层面核对、未经本会话实测**，引用时必须同样标注）：
  A. 先转存为带 BOM 的 UTF-8 再跑：`[IO.File]::WriteAllText($dst, (Get-Content -LiteralPath $src -Raw -Encoding UTF8), (New-Object System.Text.UTF8Encoding($true)))` 然后 `-File $dst`；
  B. 不落盘、不依赖 BOM：`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content -LiteralPath '…\check-ui.ps1' -Raw -Encoding UTF8; Invoke-Expression $c"`（在 **cmd** 里跑，避免外层 PowerShell 提前展开 `$c`）；
  C. 与 PowerShell 无关的**语法**兜底：把 `client.js` 拷成 `.cjs` 后 `D:\nodejs\node.exe --check <路径>`（只验语法，不跑逻辑）。
- 出处（可直接引用）：`docs/USER-ACCEPT-02-实测结果判定.md` §1.2（E-7/E-9/E-10 原始取证）、§4 F-3 与 F-3-add（5.1 命令形式与「纯 ASCII」口径）；`docs/USER-ACCEPT-01-用户实测步骤.md` §4.1（探针用户侧步骤与四种读法）、§F-6（兜底绕法）。
- 🟥 引用纪律：verifier **没有**任何 PowerShell 实测原始输出（其 `pwsh` 同样报 `SetNamedSecurityInfoW failed`，命令体从未执行，记为 E-7）。
  ⇒ 本脚本的「实测可用」只能由**用户终端**或 t8 用户验收闸门提供；我（及我方文档）**不得**把未跑过的命令写成「实测可用」。

---

## 8. 待 t3 / DATA-01 确认项（不确认就按此实现，回来再对齐）

| # | 待确认 | 我的默认实现 |
|---|---|---|
| 1 | `core/browser.js` 是否**九区齐全且各自闭合**（`BEGIN inlined file: <name>` / `END inlined file: <name>` 成对；8 个数据单元以 `})(__pmCore);` 收尾、`bootstrap` 以 `})(typeof globalThis !== 'undefined' ? globalThis : this);` 收尾） | 判据按队长裁决：**九区齐全 = 可装配**；标记用**子串容错匹配**；不等 UMD 外壳/tail/`return`，不等已作废的 `PM-CORE-INLINE`。**一致性只与 `browser.js` 标记区比对**（去行首缩进/去空行），**不与 `core/*.js` 逐行比对**（语义同源非 1:1，见 `.linecount.txt §1`）。缺区即回报队长，绝不自行拼装 |
| 2 | 浏览器侧 `store` 的 localStorage 键与 `readOnly` 降级行为 | 按 `storage.js` 现状：根键 `dsh-prompt-market:state`，未来版本/损坏 → 只读并常驻提示 |
| 3 | `search()` 失败态字段清单 | 按 `core/api.js` 现状（`ok/items/total/errors[].{code,message,showable,degraded}/degraded/filterStats/sources`） |
| 4 | `writeMode:'replace'` 的删除与迁移护栏（datasmith 侧） | 按 §5 裁决：`replace` 从取值域删除 + 加载时强制回落 `insert`；UI 不承担脏值清理。**另**：界面提供**条件「替换」动作**（非设置项）——覆盖率用**自适配提取**判定（只从捕获对象自身字段解范围，恰好 `[0, draft.length]` 才执行），解不出或不完整 ⇒ 提示 `PM_MSG_REPLACE_NEEDS_CTRL_A` 且**不写入**；§6 `spanProbe` 的实测形状用于校验该提取（该分支标 **未实测**，由 t8 验证） |

## 9. 验收项对照

| 契约 t-ui 验收项 | 落点 |
|---|---|
| ① 按钮在 `conversation.input.left`、只用 token、无硬编码颜色 | §1 按钮行 + §2 全表 + `check-ui.ps1` 断言 3 |
| ② 面板经 `conversation.input.overlay`、四页签 + 搜索/分类可用 | §3 组件树 + §1 面板行 |
| ③ 插入后文本入框、关面板、草稿仍可编辑 | §5（面板**不触碰**草稿；关闭浮层只卸载面板；「替换」为条件动作，无法判定选区时如实拒绝并提示 Ctrl+A）+ t8 实测 |
| ④ 收藏/自建增删改/打标签调用数据层接口 | §3 列表/详情/编辑 + §4 适配层 |
| ⑤ 过滤开关与 MIT 署名界面可见 | §3 `PmFilterPanel` + `PmLicenseNotice` |
| ⑥ 失败或崩溃显示错误态而非白屏 | §4 映射表 + §3 `PmBoundary` |
| （t8）P4-replace (a) 空草稿 + 未全选 ⇒ 提示 `PM_MSG_REPLACE_NEEDS_CTRL_A` 且**草稿仍为空** | §5 第 3 条分支 |
| （t8）P4-replace (b) **有内容 + 未全选 ⇒ 提示且草稿一字不变**（专抓「部分替换」静默退化） | §5 第 3 条 + `PM-NO-WRITE` 区（断言 13）+ **指纹判据** `replaced===false && beforeLength===afterLength && beforeHash===afterHash`（断言 14） |
| （t8）P4-replace (c) `Ctrl+A` 全选 ⇒ 整段替换且 `verified===true`（唯一合法替换路径） | §5 第 2/4 条（白名单覆盖率 + 读回断言） |
| （t8）P4-replace (d) 文案边界：**不得**出现「能清空草稿 / 主动覆盖草稿」表述 | §5 能力边界段 + 断言 8 |
| （t8）P4-replace (e) console 原样回传「解出的字段名 + 判定结论」 | §6 `spanProbe.coversAllBasis`（verifier 校验算法的唯一输入） |
| （判定口径）(a)(b)(c) 全对 ⇒ verifier 的 F 升 🟩；**替换动作正确 = `replaced===true && verified===true`**；出现「提示成功但草稿没变」或「未全选却部分替换」⇒ **判失败**（数据损坏级） | `docs/USER-ACCEPT-01 §6.4`、`docs/USER-ACCEPT-02 §4 F-7`；判据来源 = console 的**指纹行** |
| （纪律）「代码存在」≠「已通过」：`selftest-node.js` 等断言**从未执行**（队内无命令执行面） | §5 判定纪律段；报告不得写「自检通过」 |

---

## 10. t4 实施记录、范围说明与冻结时刻（交付时补齐）

### 10.1 交付物（全部在 t4 的 in-scope 路径 `ui/` 内）

| 文件 | 作用 |
|---|---|
| `00-core.js` | 命名空间/插槽常量/工具/草稿指纹/错误码→文案映射/`__pmCoreBrowserError` 读取 |
| `10-theme.js` | 14 个 token 白名单 + 纯 token CSS + 三序样式安装（`ctx.styles.insert` → `<style data-pm-style>` → 行内兜底） |
| `20-data.js` | 数据层适配层（bootstrap 便捷方法 + `market.*` 子面；`writeModes` 单一来源 + `IMPLEMENTABLE_WRITE_MODES = ['insert']` 白名单过滤） |
| `30-write.js` | 写入通道：`insertText` 主通道 + 异步读回断言 + 白名单覆盖率 + `PM-NO-WRITE` 拒绝区 + 指纹字段；`W.fallbackSetDraft` **仅诊断、零调用** |
| `40-probe.js` | 受控探针（只调 setDraft、三元结论、`spanProbe.fields`、非空草稿拒绝且只记长度/哈希） |
| `50-store.js` | 跨槽位模块级 store（按钮与面板是两棵 React 树） |
| `60-components.js` | 错误边界 + 按钮 + 面板（四页签/搜索/分类/加载/空态/详情/自建增删改/源管理/过滤/署名/写入诊断） |
| `70-entry.js` | `apply`/`inject`：注册 `conversation.input.left` 与 `conversation.input.overlay` 两个条目（各套错误边界） |
| `80-client-shell.js` | **装配模板**（`client.js` 外壳骨架 + 两个内联标记区），非运行入口 |
| `check-ui.ps1` / `check-ui.md` | 无需 JS 运行时的静态自检脚本（纯 ASCII，退出码 0/1）与其中文说明 |

### 10.2 裁决落地位置（供评审核对）

| 裁决/要求 | 落地位置 |
|---|---|
| F-8：产品写入不依赖 t2 诊断模块、`method` 恒为 `'insertText'` | `30-write.js`（主/后备 helper 分离；`W.fallbackSetDraft` 带「不得被产品路径调用」注释且**全目录零调用**）；`check-ui.ps1` 断言 A7/A7b/A7c/A7f |
| F-9：**无 append 语义入口**（删除而非置灰） | `20-data.js` 的 `IMPLEMENTABLE_WRITE_MODES = ['insert']` + `uiWriteModes()` 白名单过滤；UI 无该按钮；`check-ui.ps1` 断言 A7d/A7e |
| 草稿指纹（长度 + 哈希 + replaced + verified） | `30-write.js` 全路径输出 `beforeLength/afterLength/beforeHash/afterHash/replaced/verified/insertTextReturned`，拒绝区另有 `coversAllBasis/endpointKeysUsed/excludedKeys/whitelistMiss/revisionPresent/draftLengthAtCapture/noAwaitBetween`；断言 A9 |
| 拒绝分支不得有任何写入 | `30-write.js` `PM-NO-WRITE:BEGIN/END` 区（**305–331 行**）内只有 `W.log` + 对象字面量 + return；断言 A8 |
| `writeMode` 取值域单一来源、UI 不暴露无法实现的值 | `20-data.js`：选项由 `settings().settings.writeModes` 驱动，再经白名单过滤；**不硬编码**取值域数组；断言 A10/A10b |
| `testSource` 副作用如实描述 | 源管理按钮文案 = 「连通性检测（成功时同时刷新本地缓存）」（`60-components.js`） |
| 探针三元结论 + `fields` 逐字段 + 隐私 | `40-probe.js`（`conclusion ∈ written/not-written/readback-unreliable`；字符串只给长度，仅 `revision` 例外；失败记 `unconvertible`）；断言 A11 |
| 数据层未就绪的错误态 | `00-core.js` 读 `globalThis.__pmCoreBrowserError`（`E_BOOTSTRAP`），不自造原因、不白屏；断言 A11b |

### 10.3 判据来源声明（队长裁决原话，消除歧义）

> **产品写入通道的权威判据 = `ui/check-ui.ps1` 断言 A7 / A7f / A8；`docs/check-plugin.ps1` 仅覆盖 t2 试验/诊断路径，其 `setDraft` 优先断言不适用于产品面板。**

### 10.4 范围说明（t4 in-scope = `ui/`）

- `client.js` 属 t2 产物、**不在 t4 的 in-scope 路径内** ⇒ 本任务**未改动**它；装配动作按 §10.5 移交。
- `docs/check-ui.ps1` 的路径亦不在范围内 ⇒ 脚本交付在 `ui/check-ui.ps1`；若团队要统一放在 `docs/`，请由授权任务复制（逐字节相同即可）。
- `docs/DEVELOPMENT.md` 的「写入一律走 `lib/write-draft.js`」**收窄动作未做**（超出 `ui/`）⇒ 需队长指派；`core/**` 一字未动。
- 结论分栏：**静态已核对** = `check-ui.ps1` 的全部 FAIL 级检查 + 会话内 `grep` 复核；**运行时未实测** = 按钮可见性、面板开合、草稿真实入框、Ctrl+Z 可撤销、持久化、断网降级、探针三元结论（由 t8 承接）。

### 10.5 装配移交（8 + 9 → 1）

1. 以 `80-client-shell.js` 为外壳：`PM-CORE-INLINE` 区填 `core/browser.js` 的 **9 个单元体**，`PM-UI-INLINE` 区按序填 `00-core.js … 70-entry.js` **8 个单元**（均原样顶格）；
2. 每填一个单元后 `client.js` 必须仍是合法 JS（link 安装 ⇒ 下次启动即生效）；
3. 装配后重跑 `check-ui.ps1`：A13/A14 由 INFO 变为真实逐行比对（不一致会给出首个差异行号）。

### 10.6 扁平重写记录（F-11 紧急语法修复；供 verifier 复核）

> 背景：装配后的 `client.js` 在真机导入阶段抛 `Uncaught SyntaxError: Unexpected token ')'`（`client.js:6340`，源文件对应行 `60-components.js:399`），**导致 DSH 启动失败**。队长改为「扁平重写」策略后执行。

| 项 | 记录 |
|---|---|
| 触及文件 | 仅 `ui/60-components.js`（源）；`client.js` 本级**未手工改**，改由重新装配生成 |
| 重写范围 | ① 列表块（原 371–400，三层嵌套三元 → `if/else if/else` + `for` + 逐行 `listKids.push`）；② 源管理整条链（原 429–522 → `srcHead` + 逐源 `srcRows.push(buildSourceRow(...))` + `buildAddSourceBox/buildCacheBox/buildFilterBox/buildAdvancedBox` + 一行容器）；③ 尾部四块（原 546–577 → 一行一个 `children.push(...)`）；④ 另 8 处行尾 ≥3 闭括号（后端徽标 / 过滤开关 / 署名块 / 详情块 / 分页 / 编辑对话框 / 高级区 kv / 详情 kv） |
| 硬规则判据 | 「行尾连续 **≥3** 个 `)`」才算违规（队长确认）；`x.push(y(...));` 末尾的 2 个闭合属必然形态，**不得**为此拆行（拆成 `var x=…; kids.push(x)` 会多约 60 行、收益为零） |
| 改前统计 | 行尾 ≥3 闭括号：**11 处**（列表块收尾、源管理链 510/524/540/601/608/644、以及 313/327/343/419/426） |
| 改后统计 | `grep pattern="\)\)\)[;,]?$"` → **`No matches found`（0 处）** |
| 新增辅助函数 | **22 个**（此前口述「14 个」有误，以文件为准）：`editDraftOf` `makeTabClick` `rowTitleEl` `rowDescEl` `tagChipsOf` `itemMetaEl` `itemActionsEl` `buildRow` `runSourceTest` `sourceMetaEl` `sourceActionsEl` `buildSourceRow` `sourceTestBar` `buildAddSourceBox` `buildCacheBox` `buildRuleRow` `buildFilterBox` `buildAdvancedBox` `buildWriteBar` `buildProbeBar` `buildListErrorsBar` `buildFooter`（位于 `60-components.js` 261–452 行，`ns.MarketPanel` 之前） |
| 技术修正 | **React 元素没有 `appendChild`**（虚拟节点、无 DOM 方法）⇒ 等价实现为「子元素先算成变量、再用一行建好容器」；**未改 `ns.h` 语义**（队长已确认此前示例中的 `appendChild` 写法有误） |
| 行为外改动 | 仅删除原**未被使用**的 `var fav = …`（队长已确认可）；其余 class 名、文案、`title`/`aria-label`、回调体、`key`（行 `uid` / 源 `src.id` / 标签 `g+i` / 页签 `t[0]`）逐字保留 |
| 验证状态 | ⚠️ **运行时/语法实跑未由本会话取得**（无执行面：`pwsh` → `SetNamedSecurityInfoW failed (Win32 5)`）。权威验证 = 用户终端 `node -e "new (require('vm').Script)(…)"` 期望 `60-components OK`，以及 `diag-syntax.js` 全 `[OK]`；**在拿到 `OK` 之前不得记为已修复** |
| 期间状态风险 | 重写后 `client.js` 仍是旧版（含语法错误）⇒ 重新装配前重启仍会崩；顺序必须是「重新装配 → 语法验证 → 再重启」 |
