# ASSEMBLE · `plugin/core/browser.js` 的确定性拼装说明

> 本文件的存在原因：**本会话没有任何命令执行面**（`pwsh` 每次都返回
> `SetNamedSecurityInfoW failed (Win32 5)`，见 `docs/ENV-01-环境与打包事实.md` §1.1），
> 因此数据层不能靠「跑一次脚本」产出浏览器半身。
>
> 结论：`plugin/core/browser.js` **本身就是成品源码**，它 = 下表 8 个文件的**逐字节原文** +
> 本文件 §2/§4 的两段 wrapper。拼装不需要任何工具 —— 用文件读写即可完成，
> 且结果**逐字节可复现**（§6 给校验方法）。

---

## 1. 拼装顺序（**固定，勿改**）

| # | 文件（相对 `plugin/core/`） | 行数 | 角色 |
|---|---|---|---|
| 0 | `.browser-parts/head.js` | — | UMD 头 + 命名空间遮蔽 + `PM-CORE-INLINE:BEGIN` |
| 1 | `constants.js` | 499 | 真值：源 URL/字段、许可正文、配额、过滤名单、错误码 |
| 2 | `text.js` | 367 | 纯文本化 / 哈希 / 安全 JSON |
| 3 | `filter.js` | 319 | 内容过滤 |
| 4 | `storage.js` | 918 | 持久化 + 迁移护栏 + 配额护栏 + 缓存 |
| 5 | `normalize.js` | 633 | CSV(RFC4180) + 四适配器 + 归一化 |
| 6 | `net.js` | 480 | 超时 / 重试 / 429 / base64 兜底 |
| 7 | `sources.js` | 458 | 源注册表 + 单源降级管线 + 多源聚合 |
| 8 | `api.js` | 1014 | 门面（search/fav/custom/tags/sources/settings/filter/licenses/data/diag） |
| 9 | `.browser-parts/tail.js` | — | `PM-CORE-INLINE:END` + 返回公开面 |

**依赖方向只允许「后面的文件用前面的」**，所以这个顺序不能被重排。

## 2. 头的来源

`.browser-parts/head.js` = 文件顶部说明注释 + 下面这段（逐字）：

```js
(function (root, factory) {
  'use strict';
  var api = factory();
  root.__pmCoreBrowser = api;
  if (root.__pmCore === undefined || root.__pmCore === null) root.__pmCore = api;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var namespace = {};
  var globalThis = namespace;

  /* ==== PM-CORE-INLINE:BEGIN ==== */
```

要点：
- `var globalThis = namespace;` —— 8 个核心文件里写的是 `globalThis.__pmCore`，
  这里把 `globalThis` **遮蔽**成局部命名空间，因此**不会污染真实 globalThis**，
  且与 Host 侧（`plugin/core/index.js` 的沙箱求值）行为一致。
- 不 `require` 任何东西；不引用相对路径；不调用 `host.call`（队长裁决第 4 条）。

## 3. 每个内联文件的包边

第 1–8 个文件之间插入如下成对分隔注释（便于人工核对边界与做漂移比对）：

```js
/* ======================== BEGIN inlined file: constants.js ======================== */
…（constants.js 的原文，**不做任何缩进/换行改动**）…
/* ========================= END inlined file: constants.js ========================= */
```

（大写字面量以实际文件为准：`BEGIN inlined file: <文件名>` / `END inlined file: <文件名>`。）

**逐字节规则**：
1. 行尾统一为 `LF`（若源文件是 `CRLF`，先把 `\r\n` 归一化成 `\n`）；
2. 不做行首缩进调整（核心文件都是两空格缩进的 IIFE，保持原样）；
3. 文件末尾的多余空行去掉，与下一段之间用**恰好 1 个空行**分隔；
4. 除上述包边与空行外，**一个字符都不许改**。

## 4. 尾的来源

`.browser-parts/tail.js` = 下面这段（逐字）：

```js
  /* ==== PM-CORE-INLINE:END ==== */

  return {
    ok: true,
    kind: 'dsh-prompt-market-data-layer',
    dataApiMajor: namespace.constants ? namespace.constants.DATA_API_MAJOR : null,
    schemaVersion: namespace.storage ? namespace.storage.CURRENT_SCHEMA : null,
    constants: namespace.constants,
    text: namespace.text,
    filter: namespace.filter,
    storage: namespace.storage,
    normalize: namespace.normalize,
    net: namespace.net,
    sources: namespace.sources,
    api: namespace.api,
    get market() {
      return namespace.api ? namespace.api.getShared({}) : null;
    },
    createDataLayer: function (options) {
      return namespace.api.createDataLayer(options || {});
    }
  };
});
```

## 5. 最终文件骨架

```js
/* plugin/core/browser.js — 说明注释（见 .browser-parts/head.js） */
(function (root, factory) { … })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var namespace = {};
  var globalThis = namespace;
  /* ==== PM-CORE-INLINE:BEGIN ==== */
  /* ======================== BEGIN inlined file: constants.js ======================== */
  …constants.js 原文…
  /* ========================= END inlined file: constants.js ========================= */
  /* ======================== BEGIN inlined file: text.js ======================== */
  …（text → filter → storage → normalize → net → sources → api，同法）…
  /* ========================= END inlined file: api.js ========================= */
  /* ==== PM-CORE-INLINE:END ==== */
  return { …公开面… };
});
```

## 6. 校验（拼装后必须做）

```powershell
# a) 语法：browser.js 是普通脚本，可被 Node 直接编译
node --check "…\plugin\core\browser.js"

# b) 一致性：自检脚本会断言「browser.js 内含 8 个核心文件的原文」
node "…\plugin\core\selftest-node.js"

# c) 与清单对账：行数/字节/FNV-1a32 见 plugin/core/.linecount.txt
node "…\plugin\core\assemble-browser.js" --verify
```

## 7. 一键拼装（可选；有命令执行面时用）

仓库内已提供等价实现的 Node 脚本：`plugin/core/assemble-browser.js`。

```powershell
node "…\plugin\core\assemble-browser.js"            # 生成/覆盖 plugin/core/browser.js
node "…\plugin\core\assemble-browser.js" --verify   # 只校验，不改文件；退出码 0/1
```

> ⚠️ 与 `build-client-bundle.js` 一样，这两个脚本都是**可选的便利工具**：
> 不跑它们，只要 `plugin/core/browser.js` 与核心源码一致，插件就正常工作。
