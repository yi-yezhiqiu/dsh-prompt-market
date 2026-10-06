/* ==== unit: ui-core ==== */
/* 提示词市场 · UI 单元 00 —— 命名空间、插槽常量、无依赖工具、草稿指纹。
 *
 * 硬约束（与 plugin/core/browser.js 同族）：
 *   - 无 import/export、无模板字面量（反引号）、无 JSX、不 require 任何相对路径；
 *   - 只挂 globalThis.__pmUi，因此**本文件本身就是一个完整语句**，
 *     可作为「UI 内联单元」逐个写进 plugin/client.js 的 ModuleLoader factory，
 *     每写完一个单元 client.js 仍是合法 JS（link 安装下不会把半成品加载成坏状态）。
 *
 * 依据：CONSTRAINTS-01 §C（插槽 conversation.input.left / .overlay）、§D（14 个主题 token）、
 *       docs/DATA-01-数据层接口.md §2.5（bootstrap 取数入口）、队长 F-8/F-9 裁决。
 */
var __pmUi = globalThis.__pmUi || (globalThis.__pmUi = {});

(function (ns) {
  'use strict';

  /* ---------------------------------------------------------------- 身份与插槽 */
  ns.VERSION = '1.0.0';
  ns.SLOT_BUTTON = 'conversation.input.left';       /* 「提示词导入」按钮（CONSTRAINTS-01 §C） */
  ns.SLOT_PANEL = 'conversation.input.overlay';     /* 浮层市场面板（CONSTRAINTS-01 §C） */
  ns.ENTRY_BUTTON = 'prompt-market-import-button';
  ns.ENTRY_PANEL = 'prompt-market-panel';

  /* ---------------------------------------------------------------- 纯工具 */
  ns.str = function (v) { return v === null || v === undefined ? '' : String(v); };
  ns.num = function (v) {
    var n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return isFinite(n) ? n : null;
  };
  ns.clamp = function (n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); };
  ns.nowIso = function () { try { return new Date().toISOString(); } catch (e) { return ''; } };
  ns.errText = function (e) { return e && e.message ? String(e.message) : String(e); };
  ns.JSON = function (v) {
    try { return JSON.stringify(v); } catch (e) { return '"[unserializable:' + ns.errText(e) + ']"'; }
  };
  ns.log = function (tag, payload) {
    try {
      if (globalThis.console && globalThis.console.info) {
        globalThis.console.info('[prompt-market] ' + tag + ' ' + ns.JSON(payload));
      }
    } catch (e) { /* 日志失败绝不影响功能 */ }
  };
  ns.truncate = function (s, max) {
    var t = ns.str(s);
    var m = ns.num(max);
    if (m === null || m <= 0) return t;
    return t.length <= m ? t : t.slice(0, m) + '…';
  };

  /* ---------------------------------------------------------------- 哈希与草稿指纹 */
  /* FNV-1a 32bit：与数据层 contentHash 同算法；优先用已内联的 __pmCore.text.contentHash */
  function fnv1a32(text) {
    var s = ns.str(text);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  ns.hashText = function (text) {
    var c = ns.core();
    if (c && c.text && typeof c.text.contentHash === 'function') {
      try {
        var v = c.text.contentHash(ns.str(text));
        if (typeof v === 'string' && v !== '') return v;
      } catch (e) { /* 退回本地实现 */ }
    }
    return fnv1a32(text);
  };

  /* 草稿指纹：**只给长度与哈希，绝不给内容**（队长强制要求 + 隐私纪律） */
  ns.fingerprint = function (draft) {
    var s = ns.str(draft);
    return { length: s.length, hash: ns.hashText(s) };
  };

  /* ---------------------------------------------------------------- 数据层入口 */
  /* bootstrap 单元是唯一写宿主全局者（DATA-01 §2.5.3）；UI 只经它取数。 */
  ns.core = function () { return globalThis.__pmCore || null; };
  ns.browserError = function () { return globalThis.__pmCoreBrowserError || null; };
  ns.market = function () {
    var c = ns.core();
    if (!c || typeof c.getMarket !== 'function') return null;
    try { return c.getMarket(); } catch (e) { return null; }
  };
  /* 数据层是否就绪：未就绪必须读 __pmCoreBrowserError（不自造原因、不白屏） */
  ns.dataReady = function () {
    if (ns.market() !== null) return { ok: true, code: null, message: null };
    var be = ns.browserError();
    if (be && be.code) return { ok: false, code: ns.str(be.code), message: ns.str(be.message) };
    return {
      ok: false,
      code: 'E_NO_CORE',
      message: '数据层未内联：globalThis.__pmCore 不存在。请确认 client.js 的 PM-CORE-INLINE 区已写入 9 个单元。'
    };
  };
  /* 数据层错误码 → 界面文案（与 plugin/core/constants.js ERROR_CODES 对齐）。
     界面一律「可展示文案 + 原始 code」，不允许白屏。 */
  ns.ERROR_COPY = {
    E_NETWORK: '网络不可达（已展示可用的本地缓存）',
    E_TIMEOUT: '请求超时（已展示可用的本地缓存）',
    E_HTTP: '上游返回 HTTP 错误',
    E_RATE_LIMIT: '上游限流（GitHub 匿名 60 次/小时），请稍后重试',
    E_PARSE: '上游结构变化，解析失败',
    E_SCHEMA: '本地数据版本高于本插件：已只读挂载，未改写你的数据',
    E_STORAGE: '本地存储写入失败',
    E_QUOTA: '本地存储配额已满',
    E_BAD_INPUT: '输入不合法，已拒绝',
    E_NOT_FOUND: '未找到对应条目',
    E_UNSUPPORTED: '当前环境不支持该操作',
    E_NO_CORE: '数据层未内联',
    E_NO_API: '数据层接口缺失',
    E_BOOTSTRAP: '数据层未加载完整',
    E_UI_CALL: '界面调用数据层时出错',
    E_UNKNOWN: '未知错误'
  };
  ns.errorText = function (code, message) {
    var c = ns.str(code);
    var copy = ns.ERROR_COPY[c] || ns.ERROR_COPY.E_UNKNOWN;
    var m = ns.str(message);
    return (c !== '' ? '[' + c + '] ' : '') + copy + (m !== '' ? '：' + m : '');
  };
})(__pmUi);
