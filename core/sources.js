/* =============================================================================
 * core/sources.js — 源注册表与单源获取（缓存优先 + 静默降级）
 * =============================================================================
 * 职责：
 *   1) 把「内置源注册表（constants.BUILTIN_SOURCES）」与「用户在 state.sources 里的
 *      自定义源 / 覆盖项」合并成一份可用的源列表；
 *   2) 单源获取管线：内存 TTL → fetch（jsDelivr 主通道）→ 解析归一化 → 落缓存；
 *      任何一步失败都按「可展示错误态 + 继续用缓存」处理，**绝不抛异常**；
 *   3) api.github.com base64 兜底，并容忍 429（返回 rate-limited 错误态而不是崩）。
 *
 * 降级矩阵（验收 ② 要逐格覆盖）：
 *   场景                        结果 freshness      数据来源
 *   ────────────────────────── ─────────────────── ────────────────
 *   首次成功                     'live'              网络
 *   内存 TTL 命中                'memory'            内存
 *   网络失败 + 有缓存            'cache'             上次缓存（stale）
 *   网络失败 + 无缓存            'error'             空列表 + 可展示错误
 *   上游 404（源失效）           'cache' 或 'error'  同上，code=E_NOT_FOUND
 *   429 限流                     'cache' 或 'error'  code=E_RATE_LIMIT
 *   响应体超限                   'cache' 或 'error'  code=E_PARSE
 *   解析失败（结构变了）         'cache' 或 'error'  code=E_PARSE
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var normalize = core.normalize || {};
  var net = core.net || {};
  var filter = core.filter || {};

  var ERR = constants.ERROR_CODES || {};
  var NET = constants.NET_DEFAULTS || {};

  /* ---------------------------------------------------------------------------
   * 1) 源列表合并
   * ------------------------------------------------------------------------ */
  /**
   * 合并内置源 + state.sources（覆盖项与新增项）。
   * @param {object} [state] store.toJSON() 的结果
   * @returns {Array<object>} 源定义数组（顺序：内置在前，自定义在后）
   */
  function merge(state) {
    var builtins = constants.BUILTIN_SOURCES || [];
    var userSources = (state && Array.isArray(state.sources)) ? state.sources : [];
    var byId = {};
    var order = [];
    var i;

    for (i = 0; i < builtins.length; i++) {
      var b = builtins[i];
      var copy = {};
      for (var k in b) {
        if (Object.prototype.hasOwnProperty.call(b, k)) copy[k] = b[k];
      }
      byId[copy.id] = copy;
      order.push(copy.id);
    }
    for (i = 0; i < userSources.length; i++) {
      var u = userSources[i];
      if (!u || !text.str(u.id)) continue;
      if (byId[u.id]) {
        /* 覆盖项：只允许改“可配置”字段，repo/filePath/许可不允许被改掉（防误配） */
        var target = byId[u.id];
        var mutable = ['enabled', 'ref', 'enabledFallback', 'name', 'lang', 'allowGithubFallback'];
        for (var m = 0; m < mutable.length; m++) {
          if (u[mutable[m]] !== undefined) target[mutable[m]] = u[mutable[m]];
        }
      } else {
        byId[u.id] = u;
        order.push(u.id);
      }
    }

    var out = [];
    for (i = 0; i < order.length; i++) out.push(byId[order[i]]);
    return out;
  }

  /**
   * 源目录视图（UI 的「源管理」页直接用这个渲染）。
   * @param {object} [state]
   * @param {object} [statusBySource] { [sourceId]: { freshness, itemCount, error, fetchedAt } }
   */
  function catalog(state, statusBySource) {
    var list = merge(state);
    var statuses = statusBySource && typeof statusBySource === 'object' ? statusBySource : {};
    var licenses = constants.LICENSES || {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var urls = net.buildUrls ? net.buildUrls(s) : { primary: '', fallback: '' };
      var st = statuses[s.id] || {};
      var base = normalize.licenseOf ? normalize.licenseOf(s) : null;
      var full = licenses[s.licenseId] || licenses.UNKNOWN || null;
      /* license 视图同时给出：归一化摘要 + 许可正文（UI 的署名区可直接渲染 text） */
      var lic = null;
      if (base) {
        lic = {
          id: base.id,
          name: base.name,
          spdx: base.spdx,
          url: base.url,
          attributionRequired: base.attributionRequired === true,
          attributionText: base.attributionText,
          sourceUrl: base.sourceUrl,
          copyrightHolder: base.copyrightHolder,
          textSource: full ? full.textSource : '',
          text: full ? full.text : '',
          fullTextAvailable: full ? full.fullTextAvailable === true : false,
          strongAttribution: full ? full.strongAttribution === true : false
        };
      }
      out.push({
        id: s.id,
        name: s.name,
        kind: s.kind,
        origin: s.origin,
        enabled: s.enabled !== false,
        removable: s.removable === true,
        lang: s.lang,
        repo: s.repo || null,
        filePath: s.filePath || null,
        ref: s.ref || null,
        url: urls.primary || s.url || '',
        fallbackUrl: (s.enabledFallback === true || s.allowGithubFallback === true) ? (urls.fallback || '') : '',
        homepage: s.homepage || '',
        license: lic,
        licenseId: s.licenseId || 'UNKNOWN',
        licenseNote: s.licenseNote || '',
        supportsWeight: s.supportsWeight === true,
        notes: Array.isArray(s.notes) ? s.notes.slice(0) : [],
        status: {
          freshness: st.freshness || 'unknown',
          itemCount: text.num(st.itemCount) || 0,
          filteredCount: text.num(st.filteredCount) || 0,
          fetchedAt: st.fetchedAt || null,
          error: st.error || null,
          fromCache: st.freshness === 'cache'
        }
      });
    }
    return out;
  }

  function getById(state, sourceId) {
    var list = merge(state);
    for (var i = 0; i < list.length; i++) if (list[i].id === sourceId) return list[i];
    return null;
  }

  /* ---------------------------------------------------------------------------
   * 2) 单源获取
   * ------------------------------------------------------------------------ */
  var memoryCache = {}; // { [sourceId]: { at:number, payload:object } }

  function clearMemory(sourceId) {
    if (sourceId) delete memoryCache[sourceId];
    else memoryCache = {};
  }

  function errorState(code, message, extra) {
    var out = {
      ok: false,
      freshness: 'error',
      items: [],
      filteredOut: 0,
      error: { code: code || ERR.NETWORK, message: message || '未知错误', showable: true },
      meta: null
    };
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    if (out.freshness === 'cache' || out.freshness === 'memory') out.ok = true;
    return out;
  }

  function applyFilter(items, settings) {
    if (!filter.apply) return { items: items, stats: { input: items.length, kept: items.length, dropped: 0, filtered: false } };
    var res = filter.apply(items, settings);
    return { items: res.items, stats: res.stats };
  }

  /**
   * 获取单个源（缓存优先 + 静默降级）。**永不抛异常。**
   * @param {string} sourceId
   * @param {object} ctx { store, state, settings, force?:boolean, memoryTtlMs?:number, signal?:object }
   * @returns {Promise<object>} FetchOutcome（见 docs/DATA-01-数据层接口.md §7.2）
   */
  function fetchSource(sourceId, ctx) {
    var context = ctx && typeof ctx === 'object' ? ctx : {};
    var store = context.store;
    var state = context.state || (store && store.toJSON ? store.toJSON() : {});
    var settings = context.settings || (state && state.settings) || {};
    var src = getById(state, text.str(sourceId));

    if (!src) {
      return Promise.resolve(errorState(ERR.NOT_FOUND, '未找到源 id=' + text.str(sourceId) + '（可能已被删除，或用户在源管理里移除了它）。'));
    }
    var validation = normalize.validateSource ? normalize.validateSource(src) : { ok: true, errors: [] };
    if (!validation.ok) {
      return Promise.resolve(errorState(ERR.BAD_INPUT, '源配置不合法：' + validation.errors.join('；')));
    }
    if (src.enabled === false) {
      return Promise.resolve(errorState(ERR.UNSUPPORTED, '源「' + src.name + '」当前被禁用（可在源管理里重新启用）。', { disabled: true }));
    }

    var ttl = text.num(context.memoryTtlMs);
    if (ttl === null) ttl = NET.memoryTtlMs || 600000;
    var now = Date.now();
    var mem = memoryCache[src.id];
    if (!context.force && mem && (now - mem.at) < ttl) {
      var cachedMem = applyFilter(mem.payload.items, settings);
      return Promise.resolve({
        ok: true,
        freshness: 'memory',
        items: cachedMem.items,
        filteredOut: cachedMem.stats.dropped,
        filterStats: cachedMem.stats,
        source: src,
        error: null,
        meta: mem.payload.meta,
        attempts: 0
      });
    }

    var allowFallback = context.allowGithubFallback !== undefined
      ? context.allowGithubFallback === true
      : (settings.allowGithubFallback !== false && src.enabledFallback !== false);
    var resolved = net.resolveUrl(src, {
      allowFallback: allowFallback,
      token: settings.githubToken || ''
    });

    function fromCacheOrError(code, message, extra) {
      var entry = null;
      try {
        entry = store && store.cacheGet ? store.cacheGet(src.id) : null;
      } catch (e) {
        entry = null;
      }
      var details = {
        source: src,
        meta: entry ? {
          fetchedAt: entry.fetchedAt,
          url: entry.url,
          ref: entry.ref,
          itemCount: entry.itemCount,
          storedCount: entry.storedCount,
          truncated: entry.truncated === true
        } : null,
        attempts: extra && extra.attempts ? extra.attempts : 0,
        httpStatus: extra && extra.httpStatus ? extra.httpStatus : 0
      };
      if (entry && Array.isArray(entry.items) && entry.items.length > 0) {
        var cachedItems = applyFilter(entry.items, settings);
        details.ok = true;
        details.freshness = 'cache';
        details.items = cachedItems.items;
        details.filteredOut = cachedItems.stats.dropped;
        details.filterStats = cachedItems.stats;
        details.error = {
          code: code || ERR.NETWORK,
          message: (message || '抓取失败') + ' 已回退到本地缓存（' + entry.storedCount + ' / ' + entry.itemCount + ' 条，'
            + (entry.truncated ? '缓存已截断；' : '') + '抓取时间 ' + text.str(entry.fetchedAt) + '）。',
          showable: true,
          degraded: true
        };
        return details;
      }
      details.error = {
        code: code || ERR.NETWORK,
        message: (message || '抓取失败') + ' 且本地没有该源的缓存，暂时无法展示该源内容。',
        showable: true,
        degraded: true
      };
      return details;
    }

    function doFetch(url, isFallback) {
      return net.fetchText(url, {
        timeoutMs: NET.timeoutMs,
        retries: isFallback ? 1 : NET.retries,
        headers: isFallback ? (resolved.fallbackHeaders || resolved.headers) : resolved.headers,
        maxBytes: (constants.LIMITS && constants.LIMITS.RESPONSE_MAX_BYTES) || 4 * 1024 * 1024
      });
    }

    return doFetch(resolved.primary, false).then(function (res) {
      /* 主通道失败：能兜底就兜底（api.github.com base64），否则降级缓存 */
      if (!res.ok && resolved.fallback && (res.status === 404 || res.status === 403 || res.status === 429 || res.error.code === ERR.NETWORK || res.error.code === ERR.TIMEOUT)) {
        return doFetch(resolved.fallback, true).then(function (fb) {
          if (!fb.ok) {
            return fromCacheOrError(fb.error ? fb.error.code : ERR.NETWORK,
              '主通道失败（' + (res.error ? res.error.message : '未知') + '），兜底通道也失败（' + (fb.error ? fb.error.message : '未知') + '）。',
              { attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status });
          }
          var decoded = net.decodeContentsApi(text.safeParseJSON(fb.text).value);
          if (!decoded.ok) {
            return fromCacheOrError(decoded.code, '兜底通道返回体无法解码：' + decoded.message,
              { attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status });
          }
          return buildFromText(decoded.text, {
            url: fb.url, from: 'github-api-base64', fallbackUsed: true,
            attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status
          });
        });
      }
      if (!res.ok) {
        if (res.error && res.error.code === null && res.status === 304) {
          /* 304：内容未变，直接用缓存（这里不重写缓存时间，避免缓存永不老化） */
          return fromCacheOrError(ERR.NETWORK, '响应 304（内容未修改）。', { attempts: res.attempts, httpStatus: 304 });
        }
        return fromCacheOrError(res.error ? res.error.code : ERR.NETWORK, res.error ? res.error.message : '抓取失败',
          { attempts: res.attempts, httpStatus: res.status });
      }
      return buildFromText(res.text, {
        url: res.url, from: 'jsdelivr', fallbackUsed: false,
        attempts: res.attempts, httpStatus: res.status, headers: res.headers
      });
    }).catch(function (e) {
      return fromCacheOrError(ERR.NETWORK, '抓取管线异常：' + ((e && e.message) || 'unknown'));
    });

    function buildFromText(rawText, meta) {
      var adapted = normalize.adapt(rawText, src);
      if (!adapted.ok) {
        return fromCacheOrError(ERR.PARSE,
          '解析失败（结构可能已变化）：' + text.str(adapted.error || 'unknown'),
          { attempts: meta.attempts, httpStatus: meta.httpStatus });
      }
      var deduped = normalize.dedupe(adapted.items);
      var payload = {
        items: deduped.items,
        meta: {
          sourceId: src.id,
          url: meta.url,
          from: meta.from,
          fallbackUsed: meta.fallbackUsed === true,
          fetchedAt: text.nowIso(),
          itemCount: deduped.items.length,
          duplicatesRemoved: deduped.removed,
          detail: adapted.detail || {},
          httpStatus: meta.httpStatus,
          etag: meta.headers ? meta.headers.etag : '',
          lastModified: meta.headers ? meta.headers.lastModified : ''
        }
      };
      memoryCache[src.id] = { at: Date.now(), payload: payload };
      var cacheWrite = null;
      if (store && store.cacheSet) {
        cacheWrite = store.cacheSet(src.id, deduped.items, {
          url: meta.url,
          ref: src.ref || null,
          fetchedAt: payload.meta.fetchedAt,
          license: normalize.licenseOf ? normalize.licenseOf(src) : null
        });
      }
      var filtered = applyFilter(deduped.items, settings);
      return {
        ok: true,
        freshness: 'live',
        items: filtered.items,
        filteredOut: filtered.stats.dropped,
        filterStats: filtered.stats,
        source: src,
        error: null,
        meta: payload.meta,
        attempts: meta.attempts,
        cacheWrite: cacheWrite
      };
    }
  }

  /* ---------------------------------------------------------------------------
   * 3) 多源聚合（市场页首屏）
   * ------------------------------------------------------------------------ */
  /**
   * 并发抓取多个源并合并；**单源失败不影响其它源**。
   * @param {Array<string>} sourceIds
   * @param {object} fetchCtx 同 fetchSource 的 ctx
   * @returns {Promise<{ ok:boolean, items:Array, sources:Array<object>, errors:Array<object>,
   *                     totalBeforeFilter:number, totalAfterFilter:number, degraded:boolean }>}
   */
  function fetchMany(sourceIds, fetchCtx) {
    var ids = Array.isArray(sourceIds) ? sourceIds.filter(function (x) { return typeof x === 'string' && x !== ''; }) : [];
    if (ids.length === 0) {
      return Promise.resolve({
        ok: true, items: [], sources: [], errors: [],
        totalBeforeFilter: 0, totalAfterFilter: 0, degraded: false
      });
    }
    var jobs = ids.map(function (id) {
      return fetchSource(id, fetchCtx).catch(function (e) {
        return errorState(ERR.NETWORK, '源 ' + id + ' 抓取异常：' + ((e && e.message) || 'unknown'));
      });
    });
    return Promise.all(jobs).then(function (results) {
      var items = [];
      var sources = [];
      var errors = [];
      var before = 0;
      var after = 0;
      var degraded = false;
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var sid = ids[i];
        sources.push({
          sourceId: sid,
          ok: r.ok === true,
          freshness: r.freshness,
          itemCount: Array.isArray(r.items) ? r.items.length : 0,
          filteredOut: text.num(r.filteredOut) || 0,
          error: r.error || null,
          meta: r.meta || null
        });
        if (r.error && r.error.showable) errors.push({ sourceId: sid, code: r.error.code, message: r.error.message, degraded: r.error.degraded === true });
        if (r.freshness === 'cache' || r.freshness === 'memory') degraded = true;
        if (!r.ok) { continue; }
        before += (Array.isArray(r.items) ? r.items.length : 0) + (text.num(r.filteredOut) || 0);
        after += (Array.isArray(r.items) ? r.items.length : 0);
        for (var j = 0; j < r.items.length; j++) items.push(r.items[j]);
      }
      return {
        ok: true,
        items: items,
        sources: sources,
        errors: errors,
        totalBeforeFilter: before,
        totalAfterFilter: after,
        degraded: degraded
      };
    });
  }

  core.sources = {
    merge: merge,
    catalog: catalog,
    getById: getById,
    fetchSource: fetchSource,
    fetchMany: fetchMany,
    clearMemory: clearMemory,
    memorySnapshot: function () {
      var out = {};
      for (var k in memoryCache) {
        if (Object.prototype.hasOwnProperty.call(memoryCache, k)) {
          out[k] = { at: memoryCache[k].at, itemCount: memoryCache[k].payload.items.length };
        }
      }
      return out;
    }
  };
})(__pmCore);
