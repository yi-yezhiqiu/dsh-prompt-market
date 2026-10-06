/* =============================================================================
 * core/text.js — 纯文本化、HTML 中和、哈希与基础类型工具
 * =============================================================================
 * 硬需求来源：任务书 (7)「远程内容一律按纯文本处理，禁止 HTML 注入」，
 *             验收 ④「远程内容按纯文本路径产出，HTML 被转义或丢弃」。
 *
 * 设计原则：
 *   1) 数据层**只产出纯文本**。任何来自远程的字符串在进入模型前都要过
 *      sanitizeText()：先丢弃 HTML 标签，再解码实体，再清控制字符。
 *   2) 另外提供 escapeHTML()，供 UI 万一需要把文本放进 HTML 属性/富文本节点时
 *      做双保险；数据层自身永不产出 HTML。
 *   3) 不抛异常：所有函数对坏输入返回安全值。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  /* ---------------------------------------------------------------------------
   * 1) 基础类型
   * ------------------------------------------------------------------------ */
  function isString(v) {
    return typeof v === 'string';
  }

  function isFn(v) {
    return typeof v === 'function';
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  /* 只接受有限数，其余一律 null（避免 NaN / Infinity 污染排序） */
  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function bool(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === '') return false;
    }
    if (typeof v === 'number') return v !== 0;
    return false;
  }

  /* ---------------------------------------------------------------------------
   * 2) HTML 实体
   * ------------------------------------------------------------------------ */
  var NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
    laquo: '\u00ab', raquo: '\u00bb', middot: '\u00b7', bull: '\u2022',
    times: '\u00d7', divide: '\u00f7', deg: '\u00b0',
    euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
    sect: '\u00a7', para: '\u00b6', dagger: '\u2020', permil: '\u2030',
    larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
    harr: '\u2194', infin: '\u221e', ne: '\u2260', le: '\u2264', ge: '\u2265'
  };

  function codePointToString(cp) {
    if (!isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
    if (cp <= 0xffff) return String.fromCharCode(cp);
    var v = cp - 0x10000;
    var hi = 0xd800 + (v >> 10);
    var lo = 0xdc00 + (v & 0x3ff);
    return String.fromCharCode(hi, lo);
  }

  /* 解码常见命名实体与全部数字实体（十进制 &#123; / 十六进制 &#x1F600;） */
  function decodeEntities(s) {
    if (!isString(s) || s.indexOf('&') < 0) return isString(s) ? s : '';
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, function (m, body) {
      if (body.charAt(0) === '#') {
        var hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        var raw = hex ? body.slice(2) : body.slice(1);
        var cp = parseInt(raw, hex ? 16 : 10);
        if (!isFinite(cp)) return m;
        var ch = codePointToString(cp);
        return ch === '' ? m : ch;
      }
      var key = body.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key];
      return m; // 未知实体：原样保留（不猜）
    });
  }

  /* 把可能被当作 HTML 的字符转义为实体（数据层不用，留给 UI 兜底） */
  function escapeHTML(s) {
    return str(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------------------
   * 3) 纯文本化
   *
   * 顺序很重要：
   *   a. 去 <script>/<style>/<template> 整块（含内容）——这类内容即使被转义也没意义；
   *   b. 去注释；
   *   c. 块级标签换成换行（保住段落结构），其余标签丢弃；
   *   d. 解码实体；
   *   e. 清控制字符（保留 \n \t）；
   *   f. 按上限截断并标记。
   * ------------------------------------------------------------------------ */
  var BLOCK_TAGS = 'p|div|br|li|ul|ol|tr|td|th|h1|h2|h3|h4|h5|h6|section|article|blockquote|pre';

  function countTags(s) {
    if (!isString(s) || s.indexOf('<') < 0) return 0;
    var m = s.match(/<\/?[a-zA-Z][^>]*>/g);
    return m ? m.length : 0;
  }

  function stripTags(s) {
    var out = s;
    /* a. 危险整块 */
    out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ');
    out = out.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
    out = out.replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ');
    out = out.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, ' ');
    /* b. 注释（含条件注释） */
    out = out.replace(/<!--[\s\S]*?-->/g, ' ');
    /* c1. 自闭合 br / 换行类标签 */
    out = out.replace(/<br\s*\/?>/gi, '\n');
    /* c2. 块级标签的开闭都换算行，避免标题与正文黏在一起 */
    out = out.replace(new RegExp('</?(?:' + BLOCK_TAGS + ')\\b[^>]*>', 'gi'), '\n');
    /* c3. 其余标签（行内标签如 <b>/<i>/<span>/<a>，以及自闭合与属性里带 > 的朴素形态）
       **整体删除、不插入任何字符** —— 行内标签不产生词间分隔；若此处换成空格，
       '<b>粗</b>体' 会变成 '粗 体'（t22 修）。块级标签已由 c2 换算行，不受影响。 */
    out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');
    /* c4. 残留的裸 "<" / ">" 不再具备 HTML 能力，但为可读性折半角保留 */
    return out;
  }

  /* 归一化空白：不在行首/行尾堆空白，不留 3 个以上连续空行 */
  function normalizeWhitespace(s) {
    var out = s.replace(/\r\n?/g, '\n');
    /* 行内 tab 与多空格压缩 */
    out = out.replace(/[ \t\u00a0\u3000]+/g, ' ');
    /* 行尾空白 */
    out = out.replace(/[ \t]+$/gm, '');
    /* 3+ 换行压成 2 个 */
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.replace(/^\s+|\s+$/g, '');
  }

  function stripControlChars(s) {
    /* 去掉 C0/C1 控制字符，但保留 \n 与 \t */
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 9 || c === 10) { out += s.charAt(i); continue; }
      if (c < 32 || c === 127) continue;
      if (c >= 128 && c <= 159) continue;
      out += s.charAt(i);
    }
    return out;
  }

  /**
   * 把任意远程/导入字符串转成可安全展示与写入的纯文本。
   * @param {*} raw 原始值
   * @param {object} [opts] { maxChars, keepNewlines, collapseWhitespace }
   * @returns {{ text:string, changed:boolean, htmlTags:number, truncated:boolean, originalLength:number }}
   *          永不抛错。
   */
  function sanitizeText(raw, opts) {
    var options = isPlainObject(opts) ? opts : {};
    var maxChars = num(options.maxChars);
    if (maxChars === null || maxChars <= 0) maxChars = 0; // 0 = 不截断
    var keepNewlines = options.keepNewlines !== false;
    var collapse = options.collapseWhitespace !== false;

    var original = str(raw);
    if (options.normalizeNFC !== false && isFn(String.prototype.normalize)) {
      try { original = original.normalize('NFC'); } catch (e) { /* 忽略：老引擎无 normalize */ }
    }

    var htmlTags = countTags(original);
    var text = original;
    if (htmlTags > 0 || text.indexOf('&') >= 0) {
      text = stripTags(text);
      text = decodeEntities(text);
    }
    text = stripControlChars(text);
    if (!keepNewlines) text = text.replace(/\n/g, ' ');
    if (collapse) text = normalizeWhitespace(text);
    else text = text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');

    var truncated = false;
    if (maxChars > 0 && text.length > maxChars) {
      text = text.slice(0, maxChars);
      truncated = true;
    }

    return {
      text: text,
      changed: text !== original,
      htmlTags: htmlTags,
      truncated: truncated,
      originalLength: original.length
    };
  }

  /* 便捷版：只要纯文本结果 */
  function toPlainText(raw, opts) {
    return sanitizeText(raw, opts).text;
  }

  /* 判断字符串里是否含会被当作 HTML 解析的结构（给过滤/告警用） */
  function looksLikeHTML(s) {
    return countTags(s) > 0;
  }

  /* ---------------------------------------------------------------------------
   * 4) 哈希（FNV-1a 32bit，十六进制）—— 去重、缓存比对、变更检测
   * ------------------------------------------------------------------------ */
  function fnv1a32(s) {
    var h = 0x811c9dc5;
    var text = str(s);
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      /* 高 8 位也混一次，UTF-16 码元 > 255 时不至于丢信息 */
      h ^= (text.charCodeAt(i) >> 8) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function contentHash(s) {
    return fnv1a32(normalizeWhitespace(str(s)));
  }

  /* ---------------------------------------------------------------------------
   * 5) 通用小工具
   * ------------------------------------------------------------------------ */
  function nowIso(clock) {
    var d = isFn(clock) ? clock() : new Date();
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    return d.toISOString();
  }

  function clamp(v, min, max) {
    var n = num(v);
    if (n === null) n = min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /* 深拷贝（只处理 JSON 可表达的值；用于防止调用方改到内部状态） */
  function cloneJSON(v) {
    if (v === null || v === undefined) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  /* 安全 JSON.parse：不抛错，返回 { ok, value, error } */
  function safeParseJSON(text) {
    if (!isString(text) || text === '') {
      return { ok: false, value: null, error: 'empty-input' };
    }
    try {
      return { ok: true, value: JSON.parse(text), error: null };
    } catch (e) {
      return { ok: false, value: null, error: (e && e.message) ? e.message : 'json-parse-failed' };
    }
  }

  /* UTF-8 字节数估算（用于配额护栏；不依赖 TextEncoder） */
  function utf8Bytes(s) {
    var text = str(s);
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  /* 原型污染防护：导入的 JSON 里出现这些键一律丢弃 */
  var DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

  function hasDangerousKey(obj, depth) {
    var d = depth === undefined ? 0 : depth;
    if (d > 6 || !obj || typeof obj !== 'object') return false;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      if (DANGEROUS_KEYS.indexOf(keys[i]) >= 0) return true;
      if (hasDangerousKey(obj[keys[i]], d + 1)) return true;
    }
    return false;
  }

  /* 剥掉危险键（浅层 + 递归），返回新结构 */
  function stripDangerousKeys(obj, depth) {
    var d = depth === undefined ? 0 : depth;
    if (d > 8) return null;
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) arr.push(stripDangerousKeys(obj[i], d + 1));
      return arr;
    }
    if (obj && typeof obj === 'object') {
      var out = {};
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (DANGEROUS_KEYS.indexOf(key) >= 0) continue;
        out[key] = stripDangerousKeys(obj[key], d + 1);
      }
      return out;
    }
    return obj;
  }

  core.text = {
    isString: isString,
    isFn: isFn,
    isPlainObject: isPlainObject,
    str: str,
    num: num,
    bool: bool,
    decodeEntities: decodeEntities,
    escapeHTML: escapeHTML,
    stripTags: stripTags,
    countTags: countTags,
    normalizeWhitespace: normalizeWhitespace,
    stripControlChars: stripControlChars,
    sanitizeText: sanitizeText,
    toPlainText: toPlainText,
    looksLikeHTML: looksLikeHTML,
    fnv1a32: fnv1a32,
    contentHash: contentHash,
    nowIso: nowIso,
    clamp: clamp,
    cloneJSON: cloneJSON,
    safeParseJSON: safeParseJSON,
    utf8Bytes: utf8Bytes,
    hasDangerousKey: hasDangerousKey,
    stripDangerousKeys: stripDangerousKeys,
    NAMED_ENTITIES: NAMED_ENTITIES
  };
})(__pmCore);
