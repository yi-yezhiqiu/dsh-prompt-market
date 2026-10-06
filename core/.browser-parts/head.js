/* =============================================================================
 * plugin/core/browser.js — 提示词市场 · 数据层【浏览器半身成品源码】（免构建）
 * =============================================================================
 * 这是什么
 *   DSH 桌面端「提示词市场」插件的数据层，**可直接被浏览器执行、可直接内联**的
 *   自包含纯 JS 模块。零 require、零相对路径、零构建步骤、零外部依赖。
 *
 * 怎么用（t-ui / uismith 必读）
 *   方式 A（推荐，整文件内联）：
 *     把本文件**全部内容原样**放进 `plugin/client.js` 的 ModuleLoader factory 内。
 *     本文件末尾会读取「内联标记区的内容」作为待返回对象；标记区里的代码写入
 *     局部命名空间，**不污染真实 globalThis**。
 *
 *   方式 B（只内联标记区，配合可选工具）：
 *     本文件里 PM-CORE-INLINE:BEGIN 与 PM-CORE-INLINE:END 之间的代码就是那份
 *     「可内联片段」。把它整段放进 client.js 的对应标记之间即可。
 *     可选看护工具（**不是前置条件**）：
 *       node "plugin/core/build-client-bundle.js" --check    # 校验内联区是否过期
 *       node "plugin/core/build-client-bundle.js" --splice   # 幂等替换内联区
 *
 * 怎么用（Host / Node 侧）
 *     const { core } = await import('./core/index.js').then(m => m.load())
 *     const market = core.api.createDataLayer({})
 *    或者直接读本文件并求值：
 *     const src = await readFile('./core/browser.js', 'utf8')
 *     const result = new Function('globalThis', src + '\n;return globalThis.__pmCore;')(shim)
 *
 * 三条硬约束（改本文件前必读）
 *   1) 不含 `raw.` + `githubusercontent.com` 的域名（本机被阻断，CONSTRAINTS-01 §A）；
 *      全部默认地址走 cdn.jsdelivr.net，api.github.com 只作 base64 兜底。
 *   2) 不使用模板字面量（反引号）、不使用 import/export —— 内联区必须能在
 *      最朴素的解析器下通过（无编译步骤，源码即产物）。
 *   3) 不 require 任何东西，不引用任何相对路径，不调用 host.call。
 *
 * 与“可内联片段”的关系
 *   内联区内容 = 本目录下 8 个核心文件（constants/text/filter/storage/normalize/
 *   net/sources/api）的**逐字节原文**，由 `.browser-parts` 里的 wrapper 顺序拼装。
 *   生成清单（行数 / 字节 / 哈希）见 `plugin/core/.linecount.txt`；
 *   `plugin/core/selftest-node.js` 会断言「browser.js 与核心源码一致」。
 *
 * 对外公开面（命名空间对象）
 *   constants / text / filter / storage / normalize / net / sources / api
 *   —— 完整契约见 docs/DATA-01-数据层接口.md。
 * ========================================================================== */

(function (root, factory) {
  'use strict';
  var api = factory();
  root.__pmCoreBrowser = api;
  if (root.__pmCore === undefined || root.__pmCore === null) root.__pmCore = api;
  /* CommonJS / ESM / 无模块环境都能取到同一个对象 */
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * 命名空间：核心文件只往这个局部对象上挂东西（遮蔽 globalThis，不污染宿主）
   * ------------------------------------------------------------------------ */
  var namespace = {};
  var globalThis = namespace;

  /* ==== PM-CORE-INLINE:BEGIN ==== */
