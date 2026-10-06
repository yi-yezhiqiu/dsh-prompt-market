/* =============================================================================
 * core/net.js — 出站 HTTPS 抓取：URL 解析、超时、重试、限流容忍
 * =============================================================================
 * 硬规则（CONSTRAINTS-01 §A/B、REL-01 §4）：
 *   1) 默认地址一律 cdn.jsdelivr.net；
 *   2) **不得**访问 raw 域名（本机实测 fetch failed，且团队硬规则禁止）；
 *   3) api.github.com 只作 base64 兜底，且**必须容忍 429**（匿名 60 次/小时/IP）；
 *   4) 任何失败都必须转成可展示错误态，绝不抛未捕获异常。
 *
 * 本文件不依赖 Node 专有 API；只用 globalThis 上的 fetch / AbortController /
 * setTimeout（浏览器与 DSH Host 运行时都提供）。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};

  var CDN = constants.CDN || { JSDELIVR: 'https://cdn.jsdelivr.net/gh/', GITHUB_API: 'https://api.github.com/' };
  var NET = constants.NET_DEFAULTS || {};
  var LIMITS = constants.LIMITS || {};
  var ERR = constants.ERROR_CODES || {};

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function errResult(code, message, extra) {
    var out = {
      ok: false,
      status: 0,
      text: null,
      bytes: 0,
      contentType: '',
      error: { code: code, message: message, transient: false },
      attempts: 0,
      url: '',
      from: null
    };
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 1) URL 解析
   * ------------------------------------------------------------------------ */

  /* 生成 jsDelivr 主地址与 api.github.com 兜底地址（{ref} → 实际 ref） */
  function buildUrls(src) {
    var s = src && typeof src === 'object' ? src : {};
    var ref = text.str(s.ref) || 'main';
    var urls = { primary: '', fallback: '', kind: text.str(s.kind) };

    if (text.str(s.url) !== '') {
      /* 自定义源：直接用用户给的 URL */
      urls.primary = text.str(s.url);
      return urls;
    }
    var repo = text.str(s.repo);
    var filePath = text.str(s.filePath);
    if (repo === '' || filePath === '') return urls;

    var encRepo = repo.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    var encPath = filePath.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    urls.primary = CDN.JSDELIVR + encRepo + '@' + encodeURIComponent(ref) + '/' + encPath;

    /* 兜底：GitHub contents API（返回 JSON，content 字段是 base64）。
       ⚠️ base 域名是 api.github.com —— **不是** raw 域名，不得替换。 */
    var owner = repo.split('/')[0] || '';
    var name = repo.split('/')[1] || '';
    if (owner && name) {
      urls.fallback = CDN.GITHUB_API + 'repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name)
        + '/contents/' + encPath + '?ref=' + encodeURIComponent(ref);
    }
    return urls;
  }

  /**
   * 解析源的最终抓取地址（含锁定 commit sha 的能力）。
   * @param {object} src 源定义
   * @param {object} [opts] { allowFallback:boolean, meta:{etag,lastModified} }
   * @returns {{ primary:string, fallback:string, kind:string, headers:object }}
   */
  function resolveUrl(src, opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var urls = buildUrls(src);
    var headers = {
      'Accept': 'text/plain, text/csv, application/json;q=0.9, */*;q=0.5',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    };
    if (options.meta && text.str(options.meta.etag) !== '') headers['If-None-Match'] = text.str(options.meta.etag);
    if (options.meta && text.str(options.meta.lastModified) !== '') headers['If-Modified-Since'] = text.str(options.meta.lastModified);
    /* token 只发给 api.github.com；绝不把凭据带到 jsDelivr 或自定义源 */
    var token = text.str(options.token);
    var fallbackHeaders = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token !== '') fallbackHeaders['Authorization'] = 'Bearer ' + token;
    if (!options.allowFallback) urls.fallback = '';
    return {
      primary: urls.primary,
      fallback: urls.fallback,
      kind: urls.kind,
      headers: headers,
      fallbackHeaders: fallbackHeaders
    };
  }

  /* ---------------------------------------------------------------------------
   * 2) 底层取文本
   * ------------------------------------------------------------------------ */
  function readResponseText(res, maxBytes) {
    /* 先看 content-length，超大直接拒绝（避免把 8 MB 级文件读进来） */
    var len = 0;
    try {
      var cl = res.headers && text.isFn(res.headers.get) ? res.headers.get('content-length') : null;
      if (cl) len = parseInt(cl, 10) || 0;
    } catch (e) { len = 0; }
    if (maxBytes && len > maxBytes) {
      return Promise.resolve({
        ok: false,
        code: ERR.PARSE,
        message: '响应体 ' + len + ' 字节，超过上限 ' + maxBytes + ' 字节，已拒绝读取（避免整库拉取拖死界面）。'
      });
    }
    return res.text().then(function (t) {
      var bytes = text.utf8Bytes(t);
      if (maxBytes && bytes > maxBytes) {
        return {
          ok: false,
          code: ERR.PARSE,
          message: '响应体实际 ' + bytes + ' 字节，超过上限 ' + maxBytes + ' 字节，已丢弃。'
        };
      }
      return { ok: true, text: t, bytes: bytes };
    }).catch(function (e) {
      return { ok: false, code: ERR.NETWORK, message: '读取响应体失败：' + ((e && e.message) || 'unknown') };
    });
  }

  function retryAfterMs(res) {
    try {
      var ra = res.headers && text.isFn(res.headers.get) ? res.headers.get('retry-after') : null;
      if (ra) {
        var secs = parseInt(ra, 10);
        if (isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 15 * 60 * 1000);
      }
      var reset = res.headers && text.isFn(res.headers.get) ? res.headers.get('x-ratelimit-reset') : null;
      if (reset) {
        var epoch = parseInt(reset, 10);
        if (isFinite(epoch) && epoch > 0) {
          var delta = (epoch * 1000) - Date.now();
          if (delta > 0) return Math.min(delta + 500, 15 * 60 * 1000);
        }
      }
    } catch (e) { /* 忽略 */ }
    return NET.rateLimitBackoffMs || 60000;
  }

  /**
   * 带超时 / 重试 / 退避的 GET 取文本。**永不 reject**。
   * @param {string} url
   * @param {object} [options] { timeoutMs, retries, backoffMs, backoffFactor, maxBackoffMs,
   *                            headers, maxBytes, allowRateLimitRetry }
   * @returns {Promise<{ok,status,text,bytes,contentType,headers:{etag,lastModified,remaining,reset},
   *                    error,attempts,url,from}>}
   */
  function fetchText(url, options) {
    var o = options && typeof options === 'object' ? options : {};
    var timeoutMs = text.num(o.timeoutMs) || NET.timeoutMs || 15000;
    var maxAttempts = (text.num(o.retries) !== null ? text.num(o.retries) : (NET.retries === undefined ? 2 : NET.retries)) + 1;
    var backoff = text.num(o.backoffMs) || NET.backoffMs || 600;
    var factor = text.num(o.backoffFactor) || NET.backoffFactor || 3;
    var maxBackoff = text.num(o.maxBackoffMs) || NET.maxBackoffMs || 8000;
    var maxBytes = text.num(o.maxBytes) || LIMITS.RESPONSE_MAX_BYTES || 4 * 1024 * 1024;
    var headers = o.headers && typeof o.headers === 'object' ? o.headers : {};
    var allowRateLimitRetry = o.allowRateLimitRetry !== false;
    var target = text.str(url);

    if (target === '') {
      return Promise.resolve(errResult(ERR.BAD_INPUT, '空 URL，未发起请求。', { url: target }));
    }
    if (typeof fetch !== 'function') {
      return Promise.resolve(errResult(ERR.NETWORK, '当前运行时不提供 fetch()，无法联网（仍可使用缓存与本地数据）。', { url: target }));
    }

    var attempts = 0;
    var lastError = { code: ERR.NETWORK, message: '未发起请求', transient: true };

    function attempt() {
      attempts++;
      var controller = null;
      var timer = null;
      var fetchOpts = { method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store' };
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController();
          fetchOpts.signal = controller.signal;
          timer = setTimeout(function () {
            try { controller.abort(); } catch (e) { /* 忽略 */ }
          }, timeoutMs);
        }
      } catch (e) { controller = null; timer = null; }

      function cleanup() {
        if (timer) { try { clearTimeout(timer); } catch (e2) { /* 忽略 */ } timer = null; }
      }

      return fetch(target, fetchOpts).then(function (res) {
        var status = res && text.num(res.status) !== null ? res.status : 0;
        var contentType = '';
        var etag = '';
        var lastModified = '';
        var remaining = null;
        var reset = null;
        try {
          if (res.headers && text.isFn(res.headers.get)) {
            contentType = text.str(res.headers.get('content-type'));
            etag = text.str(res.headers.get('etag'));
            lastModified = text.str(res.headers.get('last-modified'));
            var rem = res.headers.get('x-ratelimit-remaining');
            if (rem !== null) remaining = text.num(rem);
            var rst = res.headers.get('x-ratelimit-reset');
            if (rst !== null) reset = text.num(rst);
          }
        } catch (e3) { /* 忽略 */ }

        /* 304：内容未变，交给上层继续用缓存 */
        if (status === 304) {
          cleanup();
          return {
            ok: false, status: 304, text: null, bytes: 0, contentType: contentType,
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: { code: null, message: 'not-modified', transient: false, notModified: true },
            attempts: attempts, url: target, from: 'network-304'
          };
        }

        if (status === 429) {
          cleanup();
          var wait = retryAfterMs(res);
          lastError = {
            code: ERR.RATE_LIMIT,
            message: 'api.github.com 匿名限流 429（60 次/小时/IP）。'
              + (remaining === 0 ? '当前配额已用尽。' : '')
              + '建议等待 ' + Math.round(wait / 1000) + ' 秒，或改用 jsDelivr 主通道；本次已静默降级为本地缓存数据。',
            transient: true,
            retryAfterMs: wait
          };
          if (allowRateLimitRetry && attempts < maxAttempts && wait <= 5000) {
            return sleep(wait).then(attempt);
          }
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network',
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: lastError
          });
        }

        if (status === 403 && remaining === 0) {
          cleanup();
          lastError = {
            code: ERR.RATE_LIMIT,
            message: 'GitHub API 403 且配额已用尽（x-ratelimit-remaining=0）。本次已静默降级为本地缓存数据。',
            transient: true
          };
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        if (status === 404 || status === 400) {
          cleanup();
          lastError = {
            code: ERR.NOT_FOUND,
            message: 'HTTP ' + status + '：上游地址不存在或参数不合法（该源可能已改名/删除文件）。',
            transient: false
          };
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        if (status < 200 || status >= 300) {
          cleanup();
          lastError = {
            code: ERR.HTTP,
            message: 'HTTP ' + status + '（' + contentType + '）。',
            transient: status >= 500
          };
          if (lastError.transient && attempts < maxAttempts) {
            var w = Math.min(backoff * Math.pow(factor, attempts - 1), maxBackoff);
            return sleep(w).then(attempt);
          }
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        return readResponseText(res, maxBytes).then(function (body) {
          cleanup();
          if (!body.ok) {
            lastError = { code: body.code, message: body.message, transient: false };
            return errResult(lastError.code, lastError.message, {
              status: status, attempts: attempts, url: target, from: 'network', error: lastError
            });
          }
          return {
            ok: true,
            status: status,
            text: body.text,
            bytes: body.bytes,
            contentType: contentType,
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: null,
            attempts: attempts,
            url: target,
            from: 'network'
          };
        });
      }).catch(function (e4) {
        cleanup();
        var name = (e4 && e4.name) ? e4.name : '';
        var msg = (e4 && e4.message) ? e4.message : 'unknown';
        var isAbort = name === 'AbortError' || /aborted/i.test(msg);
        lastError = {
          code: isAbort ? ERR.TIMEOUT : ERR.NETWORK,
          message: isAbort
            ? ('请求超时（>' + timeoutMs + ' ms）：' + target)
            : ('网络请求失败：' + msg + '（' + target + '）'),
          transient: true
        };
        if (attempts < maxAttempts) {
          var w2 = Math.min(backoff * Math.pow(factor, attempts - 1), maxBackoff);
          return sleep(w2).then(attempt);
        }
        return errResult(lastError.code, lastError.message, {
          status: 0, attempts: attempts, url: target, from: 'network', error: lastError
        });
      });
    }

    return attempt().catch(function (e) {
      /* 兜底：attempt 内部的 then/catch 已处理，这里只防 Promise 链外的意外 */
      return errResult(ERR.NETWORK, '未预期的抓取异常：' + ((e && e.message) || 'unknown'), { url: target });
    });
  }

  /* ---------------------------------------------------------------------------
   * 3) base64（api.github.com contents 兜底用；不依赖 atob/Buffer 的纯 JS 实现）
   * ------------------------------------------------------------------------ */
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Decode(input) {
    var s = text.str(input).replace(/[\r\n\t ]/g, '');
    if (s === '') return '';
    var lookup = {};
    for (var c = 0; c < B64_CHARS.length; c++) lookup[B64_CHARS.charAt(c)] = c;
    var out = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '=') break;
      if (!Object.prototype.hasOwnProperty.call(lookup, ch)) continue; // 跳过非法字符
      buffer = (buffer << 6) | lookup[ch];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
      }
    }
    /* UTF-8 字节流 → 字符串（解码失败时退化为二进制字符串） */
    try {
      var decoded = '';
      var b = 0;
      while (b < out.length) {
        var byte1 = out[b];
        var cp = 0;
        var extra = 0;
        if (byte1 < 0x80) { cp = byte1; extra = 0; }
        else if ((byte1 & 0xe0) === 0xc0) { cp = byte1 & 0x1f; extra = 1; }
        else if ((byte1 & 0xf0) === 0xe0) { cp = byte1 & 0x0f; extra = 2; }
        else if ((byte1 & 0xf8) === 0xf0) { cp = byte1 & 0x07; extra = 3; }
        else { cp = 0xfffd; extra = 0; }
        b++;
        for (var e = 0; e < extra && b < out.length; e++) {
          cp = (cp << 6) | (out[b] & 0x3f);
          b++;
        }
        if (cp <= 0xffff) decoded += String.fromCharCode(cp);
        else {
          var v = cp - 0x10000;
          decoded += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        }
      }
      return decoded;
    } catch (errDecode) {
      var fallback = '';
      for (var j = 0; j < out.length; j++) fallback += String.fromCharCode(out[j]);
      return fallback;
    }
  }

  /* 从 contents API 响应里取回文件原文并解码（永不抛错） */
  function decodeContentsApi(payload) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, code: ERR.PARSE, message: 'contents API 返回体不是对象' };
    }
    if (text.str(payload.message) !== '' && text.str(payload.content) === '') {
      return {
        ok: false,
        code: ERR.HTTP,
        message: 'contents API 报错：' + text.str(payload.message)
      };
    }
    var content = text.str(payload.content);
    if (content === '') {
      return { ok: false, code: ERR.PARSE, message: 'contents API 未返回 content 字段（可能是目录而非文件）。' };
    }
    var encoding = text.str(payload.encoding);
    if (encoding !== '' && encoding !== 'base64') {
      return { ok: false, code: ERR.UNSUPPORTED, message: 'contents API encoding=' + encoding + ' 暂不支持（仅 base64）。' };
    }
    return { ok: true, text: base64Decode(content), bytes: text.num(payload.size) };
  }

  /* ---------------------------------------------------------------------------
   * 4) 取 commit sha（用于锁定 jsDelivr 地址，防上游漂移）
   * ------------------------------------------------------------------------ */
  function resolveCommitSha(repo, ref, options) {
    var target = text.str(repo);
    if (target === '') return Promise.resolve({ ok: false, sha: null, error: { code: ERR.BAD_INPUT, message: '缺少 repo' } });
    var branch = text.str(ref) || 'main';
    var url = CDN.GITHUB_API + 'repos/' + target.split('/').map(function (p) { return encodeURIComponent(p); }).join('/')
      + '/commits/' + encodeURIComponent(branch);
    var o = options && typeof options === 'object' ? options : {};
    return fetchText(url, {
      timeoutMs: o.timeoutMs || 10000,
      retries: 1,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      maxBytes: 512 * 1024
    }).then(function (res) {
      if (!res.ok) {
        return { ok: false, sha: null, error: res.error, httpStatus: res.status };
      }
      var parsed = text.safeParseJSON(res.text);
      if (!parsed.ok || !parsed.value) {
        return { ok: false, sha: null, error: { code: ERR.PARSE, message: 'commit 响应不是合法 JSON' }, httpStatus: res.status };
      }
      var sha = text.str(parsed.value.sha);
      if (sha === '') {
        return { ok: false, sha: null, error: { code: ERR.PARSE, message: 'commit 响应缺少 sha 字段' }, httpStatus: res.status };
      }
      return { ok: true, sha: sha, error: null, httpStatus: res.status };
    });
  }

  core.net = {
    buildUrls: buildUrls,
    resolveUrl: resolveUrl,
    fetchText: fetchText,
    base64Decode: base64Decode,
    decodeContentsApi: decodeContentsApi,
    resolveCommitSha: resolveCommitSha,
    retryAfterMs: retryAfterMs,
    sleep: sleep
  };
})(__pmCore);
