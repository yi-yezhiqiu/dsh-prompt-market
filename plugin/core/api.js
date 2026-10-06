/* =============================================================================
 * plugin/core/api.js — 数据层门面（UI / verifier 唯一需要引用的对象）
 * =============================================================================
 * 组装顺序：constants → text → filter → storage → normalize → net → sources → api
 *
 * 对外主入口：
 *   var market = __pmCore.api.createDataLayer({ backend: null, clock: null })
 *   market.init()                      → 初始化（读盘 + 迁移 + 后端探测报告）
 *   market.search({ q, tab, sourceIds, page, pageSize, force })
 *                                      → 统一检索（市场 / 收藏 / 我的 三个页签都走它）
 *   market.fav.* | market.custom.* | market.tags.* | market.settings.*
 *   market.sources.* | market.licenses.* | market.data.*
 *
 * 纪律：
 *   - 所有可能出错的入口都返回 **结果对象**（{ ok, code, message } 或 Promise<…>），
 *     **绝不抛未捕获异常**；
 *   - 远程内容一律经 normalize 的纯文本管线，本文件不产出任何 HTML；
 *   - 过滤在读取时应用（见 filter.js 头部说明），默认开启。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var storage = core.storage || {};
  var sourcesMod = core.sources || {};
  var filterMod = core.filter || {};
  var normalizeMod = core.normalize || {};

  var ERR = constants.ERROR_CODES || {};

  /* ---------------------------------------------------------------------------
   * 检索辅助
   * ------------------------------------------------------------------------ */
  function itemMatches(item, q) {
    if (!item || typeof item !== 'object') return false;
    if (q === null || q === undefined || q === '') return true;
    var hay = [
      text.str(item.title),
      text.str(item.description),
      text.str(item.remark),
      text.str(item.content || item.body),
      Array.isArray(item.tags) ? item.tags.join(' ') : ''
    ].join('\n').toLowerCase();
    if (!text.isString(q)) return true;
    var terms = q.toLowerCase().split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] === '') continue;
      if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }

  function sortItems(items, mode, q) {
    var list = items.slice(0);
    var m = mode === 'title' ? 'title' : 'weight';
    list.sort(function (a, b) {
      if (m === 'weight') {
        var wa = text.num(a.weight);
        var wb = text.num(b.weight);
        if (wa === null) wa = -1;
        if (wb === null) wb = -1;
        if (wb !== wa) return wb - wa;
      }
      var ta = text.str(a.title);
      var tb = text.str(b.title);
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });
    /* 搜索时把标题命中的排前面（更符合“搜索直觉”） */
    if (m === 'weight' && text.str(q) !== '') {
      var needle = text.str(q).toLowerCase();
      list.sort(function (a, b) {
        var ha = text.str(a.title).toLowerCase().indexOf(needle) >= 0 ? 1 : 0;
        var hb = text.str(b.title).toLowerCase().indexOf(needle) >= 0 ? 1 : 0;
        return hb - ha;
      });
    }
    return list;
  }

  /* ---------------------------------------------------------------------------
   * 数据层工厂
   * ------------------------------------------------------------------------ */
  /**
   * @param {object} [options] { backend, clock, store, fetchImpl }
   * @returns {object} 数据层 API（见 docs/DATA-01-数据层接口.md §4）
   */
  function createDataLayer(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = opts.store || storage.createStore({
      backend: opts.backend || null,
      clock: opts.clock || null
    });

    var initReport = null;
    var sourceStatus = {};   // { [sourceId]: { freshness, itemCount, filteredOut, fetchedAt, error } }

    /* ------------------------------ init ------------------------------ */
    function init() {
      var r = { ok: false, store: null, backendReport: null, warnings: [], migrated: false };
      try {
        var loaded = store.load();
        r.ok = loaded.ok === true;
        r.migrated = loaded.migrated === true;
        r.code = loaded.code || null;
        r.message = loaded.message || null;
        r.backendReport = loaded.reported || store.backendReport;
      } catch (e) {
        r.ok = false;
        r.code = ERR.STORAGE;
        r.message = '初始化持久层失败：' + ((e && e.message) || 'unknown');
      }
      try {
        r.store = store.status();
        r.warnings = r.store.warnings || [];
      } catch (e2) {
        r.store = null;
      }
      initReport = r;
      return r;
    }

    function state() {
      return store.toJSON();
    }

    function settings() {
      var s = state();
      return s.settings || storage.defaultSettings();
    }

    /* ------------------------- 远程获取（带状态记账） ----------------- */
    function fetchSource(sourceId, fetchOptions) {
      var o = fetchOptions && typeof fetchOptions === 'object' ? fetchOptions : {};
      var s = state();
      return sourcesMod.fetchSource(sourceId, {
        store: store,
        state: s,
        settings: s.settings,
        force: o.force === true,
        memoryTtlMs: o.memoryTtlMs,
        allowGithubFallback: o.allowGithubFallback
      }).then(function (out) {
        sourceStatus[sourceId] = {
          freshness: out.freshness,
          itemCount: Array.isArray(out.items) ? out.items.length : 0,
          filteredOut: text.num(out.filteredOut) || 0,
          fetchedAt: out.meta ? out.meta.fetchedAt : null,
          error: out.error || null
        };
        return out;
      }).catch(function (e) {
        var code = ERR.NETWORK;
        var message = '抓取源 ' + sourceId + ' 时发生未预期异常：' + ((e && e.message) || 'unknown');
        sourceStatus[sourceId] = { freshness: 'error', itemCount: 0, filteredOut: 0, fetchedAt: null, error: { code: code, message: message, showable: true } };
        return { ok: false, freshness: 'error', items: [], filteredOut: 0, error: { code: code, message: message, showable: true }, meta: null };
      });
    }

    function enabledSourceIds() {
      var s = state();
      var list = sourcesMod.merge(s);
      var ids = [];
      for (var i = 0; i < list.length; i++) if (list[i].enabled !== false) ids.push(list[i].id);
      return ids;
    }

    /* ------------------------------ 检索 ------------------------------ */
    /**
     * @param {object} [query] { q, tab:'market'|'favorites'|'mine'|'all', sourceIds, enabledOnly,
     *                           page, pageSize, force, includeFiltered }
     * @returns {Promise<object>} 见 docs/DATA-01-数据层接口.md §7.1
     */
    function search(query) {
      var q = query && typeof query === 'object' ? query : {};
      var tab = text.str(q.tab) || 'market';
      var s = state();
      var cfg = s.settings || {};
      var keyword = text.str(q.q);
      var filterSettings = cfg.filter || (filterMod.defaultSettings ? filterMod.defaultSettings() : { enabled: true });

      var gather;
      if (tab === 'favorites') {
        gather = Promise.resolve({ items: (s.favorites || []).slice(0), errors: [] });
      } else if (tab === 'mine') {
        gather = Promise.resolve({ items: (s.customs || []).slice(0), errors: [] });
      } else if (tab === 'all') {
        gather = Promise.all([
          Promise.resolve({ items: (s.favorites || []).concat(s.customs || []), errors: [] }),
          fetchEnabledSources(q)
        ]).then(function (both) {
          return { items: both[0].items.concat(both[1].items), errors: both[0].errors.concat(both[1].errors) };
        });
      } else {
        gather = fetchEnabledSources(q);
      }

      return gather.then(function (res) {
        var all = Array.isArray(res.items) ? res.items : [];
        /* 1) 关键字 */
        var searched = [];
        for (var i = 0; i < all.length; i++) {
          if (itemMatches(all[i], keyword)) searched.push(all[i]);
        }
        /* 2) 过滤（读取时应用） */
        var filteredResult = filterMod.apply ? filterMod.apply(searched, filterSettings) : { items: searched, stats: { input: searched.length, kept: searched.length, dropped: 0, filtered: false } };
        /* 3) 排序 */
        var sorted = sortItems(filteredResult.items, cfg.sort, keyword);
        /* 4) 分页 */
        var pageSize = text.num(q.pageSize);
        if (pageSize === null) pageSize = text.num(cfg.pageSize);
        if (pageSize === null) pageSize = 60;
        pageSize = text.clamp(pageSize, 1, 200);
        var page = text.num(q.page);
        if (page === null) page = 1;
        page = Math.max(1, Math.floor(page));
        var total = sorted.length;
        var start = (page - 1) * pageSize;
        var items = sorted.slice(start, start + pageSize);

        return {
          ok: true,
          tab: tab,
          q: keyword,
          page: page,
          pageSize: pageSize,
          total: total,
          hasMore: start + items.length < total,
          items: items,
          filteredCount: filteredResult.stats.dropped,
          filterStats: filteredResult.stats,
          errors: res.errors || [],
          sources: sourceStatus,
          degraded: (res.errors || []).some(function (e) { return e.degraded === true; })
        };
      }).catch(function (e) {
        return {
          ok: false,
          tab: tab,
          q: keyword,
          page: 1,
          pageSize: 60,
          total: 0,
          hasMore: false,
          items: [],
          filteredCount: 0,
          filterStats: null,
          errors: [{ code: ERR.NETWORK, message: '检索过程异常：' + ((e && e.message) || 'unknown'), degraded: true }],
          sources: sourceStatus,
          degraded: true
        };
      });
    }

    function fetchEnabledSources(q) {
      var s = state();
      var ids = Array.isArray(q.sourceIds) && q.sourceIds.length > 0 ? q.sourceIds.slice(0) : enabledSourceIds();
      if (ids.length === 0) return Promise.resolve({ items: [], errors: [] });
      return sourcesMod.fetchMany(ids, {
        store: store,
        state: s,
        settings: s.settings,
        force: q.force === true,
        memoryTtlMs: q.memoryTtlMs,
        allowGithubFallback: q.allowGithubFallback
      }).then(function (merged) {
        /* 记账：把每个源的状态写进 sourceStatus（供源管理页渲染） */
        for (var i = 0; i < merged.sources.length; i++) {
          var ss = merged.sources[i];
          sourceStatus[ss.sourceId] = {
            freshness: ss.freshness,
            itemCount: ss.itemCount,
            filteredOut: ss.filteredOut,
            fetchedAt: ss.meta ? ss.meta.fetchedAt : null,
            error: ss.error
          };
        }
        return { items: merged.items, errors: merged.errors };
      }).catch(function (e) {
        return {
          items: [],
          errors: [{ code: ERR.NETWORK, message: '多源聚合异常：' + ((e && e.message) || 'unknown'), degraded: true }]
        };
      });
    }

    /* ---------------------------- 收藏 ---------------------------- */
    var fav = {
      list: function () {
        return { ok: true, items: (state().favorites || []).slice(0) };
      },
      has: function (uid) {
        var list = state().favorites || [];
        for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return true;
        return false;
      },
      toggle: function (item) {
        if (!item || !text.str(item.uid || item.id)) {
          return { ok: false, code: ERR.BAD_INPUT, message: '收藏需要带 uid 的条目对象。' };
        }
        var uid = text.str(item.uid || item.id);
        var exists = fav.has(uid);
        var res = store.update(function (draft) {
          draft.favorites = (draft.favorites || []).filter(function (x) { return x.uid !== uid; });
          if (!exists) {
            var it = storage.migrateItem(item);
            if (it) draft.favorites.push(it);
          }
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, favorited: !exists, uid: uid, code: null, message: res.message || null };
      },
      add: function (item) {
        if (!fav.has(text.str(item && (item.uid || item.id)))) return fav.toggle(item);
        return { ok: true, favorited: true, uid: text.str(item.uid || item.id), code: null, message: null };
      },
      remove: function (uid) {
        var id = text.str(uid);
        var existed = fav.has(id);
        var res = store.update(function (draft) {
          draft.favorites = (draft.favorites || []).filter(function (x) { return x.uid !== id; });
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, removed: existed, uid: id, code: null, message: null };
      },
      clear: function () {
        var res = store.update(function (draft) { draft.favorites = []; return draft; });
        return res.ok ? { ok: true, code: null, message: null } : res;
      }
    };

    /* -------------------------- 自建提示词 -------------------------- */
    var custom = {
      list: function () {
        return { ok: true, items: (state().customs || []).slice(0) };
      },
      get: function (uid) {
        var list = state().customs || [];
        for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return { ok: true, item: list[i] };
        return { ok: false, code: ERR.NOT_FOUND, message: '未找到自建提示词 ' + text.str(uid) };
      },
      create: function (input) {
        var i = input && typeof input === 'object' ? input : {};
        var title = text.sanitizeText(i.title, { maxChars: 300, keepNewlines: false }).text;
        var content = text.sanitizeText(i.content || i.body || i.prompt, { maxChars: 20000 }).text;
        if (title === '' && content === '') {
          return { ok: false, code: ERR.BAD_INPUT, message: '标题与正文不能同时为空。' };
        }
        var id = 'local-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
        var item = {
          uid: 'local:' + id,
          id: 'local:' + id,
          sourceId: 'local',
          nativeId: id,
          title: title,
          content: content,
          body: content,
          tags: normalizeMod.stringsOf ? normalizeMod.stringsOf(i.tags, 20) : [],
          lang: text.str(i.lang) || 'zh',
          author: i.author === undefined ? null : text.str(i.author),
          description: text.sanitizeText(i.description, { maxChars: 2000, keepNewlines: false }).text,
          remark: text.sanitizeText(i.remark, { maxChars: 2000, keepNewlines: false }).text,
          weight: null,
          website: null,
          sourceUrl: '',
          license: null,
          sanitized: true,
          contentHash: text.contentHash(content || title),
          custom: true,
          createdAt: text.nowIso(),
          updatedAt: text.nowIso()
        };
        var res = store.update(function (draft) {
          draft.customs = draft.customs || [];
          draft.customs.push(item);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, item: item, code: null, message: null };
      },
      update: function (uid, patch) {
        var id = text.str(uid);
        var p = patch && typeof patch === 'object' ? patch : {};
        var found = null;
        var res = store.update(function (draft) {
          draft.customs = draft.customs || [];
          for (var i = 0; i < draft.customs.length; i++) {
            if (draft.customs[i].uid !== id) continue;
            var cur = draft.customs[i];
            var next = storage.migrateItem(cur) || cur;
            if (p.title !== undefined) next.title = text.sanitizeText(p.title, { maxChars: 300, keepNewlines: false }).text;
            if (p.content !== undefined || p.body !== undefined) {
              var c = text.sanitizeText(p.content !== undefined ? p.content : p.body, { maxChars: 20000 }).text;
              next.content = c;
              next.body = c;
            }
            if (p.tags !== undefined) next.tags = normalizeMod.stringsOf ? normalizeMod.stringsOf(p.tags, 20) : [];
            if (p.description !== undefined) next.description = text.sanitizeText(p.description, { maxChars: 2000, keepNewlines: false }).text;
            if (p.remark !== undefined) next.remark = text.sanitizeText(p.remark, { maxChars: 2000, keepNewlines: false }).text;
            next.custom = true;
            next.contentHash = text.contentHash(next.content || next.title);
            next.updatedAt = text.nowIso();
            draft.customs[i] = next;
            found = next;
            break;
          }
          return draft;
        });
        if (!res.ok) return res;
        if (!found) return { ok: false, code: ERR.NOT_FOUND, message: '未找到自建提示词 ' + id };
        return { ok: true, item: found, code: null, message: null };
      },
      remove: function (uid) {
        var id = text.str(uid);
        var removed = false;
        var res = store.update(function (draft) {
          var before = (draft.customs || []).length;
          draft.customs = (draft.customs || []).filter(function (x) { return x.uid !== id; });
          removed = draft.customs.length < before;
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, removed: removed, code: null, message: null };
      },
      duplicate: function (uid) {
        var got = custom.get(uid);
        if (!got.ok) return got;
        return custom.create({
          title: got.item.title + '（副本）',
          content: got.item.content,
          tags: got.item.tags,
          description: got.item.description,
          remark: got.item.remark
        });
      }
    };

    /* ---------------------------- 标签 ---------------------------- */
    var tags = {
      list: function () {
        var stored = (state().tags || []).slice(0);
        var derived = {};
        var pools = (state().customs || []).concat(state().favorites || []);
        for (var i = 0; i < pools.length; i++) {
          var t = pools[i].tags || [];
          for (var j = 0; j < t.length; j++) derived[t[j]] = true;
        }
        var extra = Object.keys(derived).filter(function (x) { return stored.indexOf(x) < 0; });
        return { ok: true, tags: stored.concat(extra) };
      },
      add: function (tag) {
        var name = text.sanitizeText(tag, { maxChars: 40, keepNewlines: false }).text.trim();
        if (name === '') return { ok: false, code: ERR.BAD_INPUT, message: '标签不能为空。' };
        var res = store.update(function (draft) {
          draft.tags = draft.tags || [];
          /* 不区分大小写的去重 */
          var exists = draft.tags.some(function (x) { return x.toLowerCase() === name.toLowerCase(); });
          if (!exists) draft.tags.push(name);
          return draft;
        });
        return res.ok ? { ok: true, tag: name, code: null, message: null } : res;
      },
      rename: function (from, to) {
        var a = text.str(from);
        var b = text.sanitizeText(to, { maxChars: 40, keepNewlines: false }).text.trim();
        if (a === '' || b === '') return { ok: false, code: ERR.BAD_INPUT, message: '重命名需要旧名与新名。' };
        var res = store.update(function (draft) {
          draft.tags = (draft.tags || []).map(function (x) { return x === a ? b : x; });
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var list = draft[pools[p]] || [];
            for (var i = 0; i < list.length; i++) {
              if (!Array.isArray(list[i].tags)) continue;
              list[i].tags = list[i].tags.map(function (x) { return x === a ? b : x; });
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, from: a, to: b, code: null, message: null } : res;
      },
      remove: function (tag) {
        var a = text.str(tag);
        var res = store.update(function (draft) {
          draft.tags = (draft.tags || []).filter(function (x) { return x !== a; });
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var list = draft[pools[p]] || [];
            for (var i = 0; i < list.length; i++) {
              if (Array.isArray(list[i].tags)) {
                list[i].tags = list[i].tags.filter(function (x) { return x !== a; });
              }
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, tag: a, code: null, message: null } : res;
      },
      /* 给某条自建/收藏打标签（远程条目本身不可变，标签只能落在收藏副本上） */
      apply: function (uid, nextTags) {
        var id = text.str(uid);
        var list = normalizeMod.stringsOf ? normalizeMod.stringsOf(nextTags, 20) : [];
        var res = store.update(function (draft) {
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var arr = draft[pools[p]] || [];
            for (var i = 0; i < arr.length; i++) {
              if (arr[i].uid === id) arr[i].tags = list.slice(0);
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, uid: id, tags: list, code: null, message: null } : res;
      }
    };

    /* ---------------------------- 源管理 ---------------------------- */
    var sourcesApi = {
      list: function () {
        return { ok: true, sources: sourcesMod.catalog(state(), sourceStatus) };
      },
      get: function (sourceId) {
        var src = sourcesMod.getById(state(), text.str(sourceId));
        if (!src) return { ok: false, code: ERR.NOT_FOUND, message: '未找到源 ' + text.str(sourceId) };
        return { ok: true, source: src, status: sourceStatus[src.id] || null };
      },
      add: function (input) {
        var normalized = storage.normalizeSource(input);
        if (!normalized) {
          return { ok: false, code: ERR.BAD_INPUT, message: '自定义源至少需要 id 与 url（https:// 开头）。' };
        }
        var existing = sourcesMod.getById(state(), normalized.id);
        if (existing && existing.origin !== 'custom') {
          return { ok: false, code: ERR.BAD_INPUT, message: '源 id ' + normalized.id + ' 与内置源冲突，请换一个 id。' };
        }
        if (existing) {
          return { ok: false, code: ERR.BAD_INPUT, message: '源 id ' + normalized.id + ' 已存在，请改用 update 或换 id。' };
        }
        var validation = normalizeMod.validateSource ? normalizeMod.validateSource(normalized) : { errors: [], warnings: [] };
        var res = store.update(function (draft) {
          draft.sources = draft.sources || [];
          draft.sources.push(normalized);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, source: normalized, warnings: validation.warnings, code: null, message: null };
      },
      update: function (sourceId, patch) {
        var id = text.str(sourceId);
        var p = patch && typeof patch === 'object' ? patch : {};
        var found = null;
        var res = store.update(function (draft) {
          draft.sources = draft.sources || [];
          for (var i = 0; i < draft.sources.length; i++) {
            if (draft.sources[i].id !== id) continue;
            var merged = {};
            for (var k in draft.sources[i]) {
              if (Object.prototype.hasOwnProperty.call(draft.sources[i], k)) merged[k] = draft.sources[i][k];
            }
            for (var k2 in p) {
              if (Object.prototype.hasOwnProperty.call(p, k2)) merged[k2] = p[k2];
            }
            merged.id = id;
            draft.sources[i] = storage.normalizeSource(merged) || draft.sources[i];
            found = draft.sources[i];
            break;
          }
          if (!found) {
            /* 内置源不能改 url/repo，但允许把 enabled/ref 记成覆盖项 */
            var builtin = sourcesMod.getById(draft, id);
            if (builtin && builtin.origin !== 'custom') {
              var override = { id: id };
              if (p.enabled !== undefined) override.enabled = p.enabled !== false;
              if (p.ref !== undefined) override.ref = p.ref;
              if (p.enabledFallback !== undefined) override.enabledFallback = p.enabledFallback === true;
              if (p.allowGithubFallback !== undefined) override.allowGithubFallback = p.allowGithubFallback === true;
              var withUrl = {
                id: id,
                name: builtin.name,
                kind: builtin.kind,
                origin: 'custom',
                enabled: override.enabled === undefined ? builtin.enabled !== false : override.enabled,
                removable: false,
                lang: builtin.lang,
                url: sourcesMod.getById(draft, id) ? '' : '',
                ref: override.ref === undefined ? (builtin.ref || 'main') : override.ref,
                enabledFallback: override.enabledFallback === undefined ? builtin.enabledFallback === true : override.enabledFallback,
                homepage: builtin.homepage || '',
                licenseId: builtin.licenseId || 'UNKNOWN',
                licenseNote: builtin.licenseNote || '',
                supportsWeight: builtin.supportsWeight === true,
                notes: ['内置源的可配置覆盖项（enabled / ref / 兜底开关）。'],
                addedAt: text.nowIso()
              };
              draft.sources.push(storage.normalizeSource(withUrl) || withUrl);
              found = draft.sources[draft.sources.length - 1];
            }
          }
          return draft;
        });
        if (!res.ok) return res;
        if (!found) return { ok: false, code: ERR.BAD_INPUT, message: '内置源不允许修改 URL 等核心字段；仅支持启用状态与 ref（commit sha）覆盖。' };
        return { ok: true, source: found, code: null, message: null };
      },
      remove: function (sourceId) {
        var id = text.str(sourceId);
        var src = sourcesMod.getById(state(), id);
        if (src && src.origin !== 'custom') {
          return { ok: false, code: ERR.BAD_INPUT, message: '内置源不可删除；如需停用请用 setEnabled(false)（可随时恢复）。' };
        }
        var removed = false;
        var res = store.update(function (draft) {
          var before = (draft.sources || []).length;
          draft.sources = (draft.sources || []).filter(function (x) { return !(x.id === id && x.origin === 'custom'); });
          removed = draft.sources.length < before;
          return draft;
        });
        if (!res.ok) return res;
        if (removed && store.cacheRemove) store.cacheRemove(id);
        return { ok: true, removed: removed, code: null, message: null };
      },
      setEnabled: function (sourceId, enabled) {
        return sourcesApi.update(sourceId, { enabled: enabled === true });
      },
      /* 连通性自检：不发全量请求会浪费配额，这里只做一次 HEAD 式 GET（range 不保证，故直接 GET 但用 force=false 走 TTL） */
      test: function (sourceId, testOptions) {
        var o = testOptions && typeof testOptions === 'object' ? testOptions : {};
        return fetchSource(sourceId, { force: true, memoryTtlMs: 0, allowGithubFallback: o.allowGithubFallback !== false }).then(function (out) {
          var s = state();
          var src = sourcesMod.getById(s, text.str(sourceId));
          var urls = src && core.net && core.net.buildUrls ? core.net.buildUrls(src) : { primary: '', fallback: '' };
          return {
            ok: out.ok === true,
            sourceId: sourceId,
            freshness: out.freshness,
            itemCount: Array.isArray(out.items) ? out.items.length : 0,
            error: out.error || null,
            urlsUsed: { primary: urls.primary, fallback: urls.fallback },
            meta: out.meta || null
          };
        });
      },
      fetch: fetchSource,
      refreshAll: function (o) {
        var ids = enabledSourceIds();
        var opts = o && typeof o === 'object' ? o : {};
        var jobs = ids.map(function (id) { return fetchSource(id, { force: true, memoryTtlMs: 0, allowGithubFallback: opts.allowGithubFallback !== false }); });
        return Promise.all(jobs).then(function (list) {
          return {
            ok: true,
            results: list.map(function (r, i) {
              return { sourceId: ids[i], ok: r.ok === true, freshness: r.freshness, itemCount: Array.isArray(r.items) ? r.items.length : 0, error: r.error || null };
            }),
            degraded: list.some(function (r) { return r.freshness === 'cache'; })
          };
        });
      },
      status: function () {
        return { ok: true, bySource: text.cloneJSON(sourceStatus) || {}, catalog: sourcesMod.catalog(state(), sourceStatus) };
      },
      cacheStats: function () {
        try { return { ok: true, stats: store.cacheStats() }; } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '读取缓存统计失败：' + ((e && e.message) || 'unknown') };
        }
      },
      clearCache: function (sourceId) {
        try {
          if (text.str(sourceId) !== '') {
            var r = store.cacheRemove(sourceId);
            sourcesMod.clearMemory(sourceId);
            return { ok: r.ok !== false, code: r.code || null, message: r.message || null };
          }
          var all = store.cacheClear();
          sourcesMod.clearMemory();
          return { ok: all.ok !== false, removed: all.removed, code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '清理缓存失败：' + ((e && e.message) || 'unknown') };
        }
      }
    };

    /* ---------------------------- 设置 ---------------------------- */
    var settingsApi = {
      get: function () {
        return {
          ok: true,
          settings: settings(),
          /* UI 直接用这个渲染写入方式单选；**不含 'replace'**（本机无实现路径） */
          writeModes: (storage.WRITE_MODES || ['insert', 'append']).slice(0)
        };
      },
      update: function (patch) {
        var p = patch && typeof patch === 'object' ? patch : {};
        /* 护栏：writeMode 只接受有实现路径的取值；非法值（尤其旧的 'replace'）
           直接拒绝，而不是静默接受后由底层回落 —— 让调用方立刻知道它不存在。 */
        if (p.writeMode !== undefined) {
          var isOk = storage.isWriteMode
            ? storage.isWriteMode(p.writeMode)
            : (p.writeMode === 'insert' || p.writeMode === 'append');
          if (!isOk) {
            return {
              ok: false,
              code: ERR.BAD_INPUT,
              message: 'writeMode 只支持 "insert"（光标处插入）与 "append"（追加到草稿末尾）。'
                + '「覆盖整段草稿」不是设置项：插件无法主动清空草稿或设置选区，'
                + '但用户在编辑器里 Ctrl+A 全选后再插入，即等价于覆盖整段'
                + '（insertText 作用在捕获到的选区上）。（收到：' + JSON.stringify(p.writeMode) + '）'
            };
          }
        }
        var res = store.update(function (draft) {
          var merged = {};
          var cur = draft.settings || storage.defaultSettings();
          for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) merged[k] = cur[k];
          for (var k2 in p) if (Object.prototype.hasOwnProperty.call(p, k2)) merged[k2] = p[k2];
          if (p.filter && typeof p.filter === 'object' && cur.filter) {
            var f = {};
            for (var fk in cur.filter) if (Object.prototype.hasOwnProperty.call(cur.filter, fk)) f[fk] = cur.filter[fk];
            for (var fk2 in p.filter) if (Object.prototype.hasOwnProperty.call(p.filter, fk2)) f[fk2] = p.filter[fk2];
            merged.filter = f;
          }
          draft.settings = storage.normalizeSettings(merged);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, settings: settings(), writeModes: (storage.WRITE_MODES || []).slice(0), code: null, message: null };
      },
      reset: function () {
        var res = store.update(function (draft) {
          draft.settings = storage.defaultSettings();
          return draft;
        });
        return res.ok ? { ok: true, settings: settings(), code: null, message: null } : res;
      }
    };

    /* ---------------------------- 过滤 ---------------------------- */
    var filterApi = {
      get: function () {
        var s = settings();
        return {
          ok: true,
          settings: s.filter,
          rules: filterMod.rules ? filterMod.rules(s.filter) : [],
          enabled: !(s.filter && s.filter.enabled === false),
          actionMode: (s.filter && s.filter.actionMode) || 'hide'
        };
      },
      setEnabled: function (enabled) {
        return settingsApi.update({ filter: { enabled: enabled === true } });
      },
      setActionMode: function (mode) {
        return settingsApi.update({ filter: { actionMode: mode === 'mark' ? 'mark' : 'hide' } });
      },
      setCustomTerms: function (terms) {
        return settingsApi.update({ filter: { customTerms: Array.isArray(terms) ? terms : [] } });
      },
      setRuleEnabled: function (ruleId, enabled) {
        var s = settings();
        var f = s.filter || {};
        var disabled = (f.disabledRuleIds || []).filter(function (x) { return x !== ruleId; });
        var extra = (f.extraRuleIds || []).filter(function (x) { return x !== ruleId; });
        if (enabled === true) extra.push(ruleId); else disabled.push(ruleId);
        return settingsApi.update({ filter: { disabledRuleIds: disabled, extraRuleIds: extra } });
      },
      checkText: function (s) {
        var cfg = settings();
        var res = filterMod.check ? filterMod.check(s, cfg.filter) : { blocked: false, matches: [] };
        return { ok: true, blocked: res.blocked === true, matches: res.matches, actionMode: res.actionMode };
      },
      /* 对任意条目列表做一次“如果现在过滤”会怎样（UI 预览用，不写盘） */
      preview: function (items) {
        var cfg = settings();
        var res = filterMod.apply ? filterMod.apply(items, cfg.filter) : { items: items, stats: null };
        return { ok: true, items: res.items, stats: res.stats };
      }
    };

    /* ---------------------------- 许可与署名 ---------------------------- */
    var licensesApi = {
      list: function () {
        var out = [];
        var all = constants.LICENSES || {};
        for (var k in all) {
          if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
          var l = all[k];
          out.push({
            id: l.id,
            name: l.name,
            spdx: l.spdx,
            url: l.url,
            attributionRequired: l.attributionRequired === true,
            attributionText: l.attributionText,
            sourceUrl: l.sourceUrl,
            copyrightHolder: l.copyrightHolder,
            textSource: l.textSource,
            fullText: l.text,
            fullTextAvailable: l.fullTextAvailable === true,
            strongAttribution: l.strongAttribution === true
          });
        }
        return { ok: true, licenses: out, acknowledged: state().licenseAcknowledged === true };
      },
      get: function (licenseId) {
        var all = constants.LICENSES || {};
        var l = all[text.str(licenseId)];
        if (!l) return { ok: false, code: ERR.NOT_FOUND, message: '未知许可 id=' + text.str(licenseId) };
        return { ok: true, license: l };
      },
      /* 生成界面/分发物用的署名文案（中文库 MIT 为强制项） */
      notice: function () {
        var catalogList = sourcesMod.catalog(state(), sourceStatus);
        var lines = ['本插件的提示词数据来自以下上游项目：'];
        var strong = [];
        for (var i = 0; i < catalogList.length; i++) {
          var s = catalogList[i];
          var lic = s.license || {};
          lines.push('· ' + s.name + '（' + s.id + '）');
          lines.push('  来源：' + (s.homepage || s.url));
          lines.push('  许可：' + (lic.name || s.licenseId || '未知') + (lic.url ? '（' + lic.url + '）' : ''));
          if (lic.attributionText) lines.push('  署名：' + lic.attributionText);
          if (lic.strongAttribution) strong.push(s.id);
        }
        lines.push('');
        /* F-R2-2：按 catalogue 实际引用的**每个 distinct licenseId** 分别附「表头 + 正文」。
           旧写法只附一份 MIT 正文、表头写死 rockbenben/ChatGPT-Shortcut ⇒ 会出现
           「一份来源的正文 + 分属两个来源的署名」。MIT 与 MIT-plexpt 正文除版权行外逐字相同，
           但**版权人不同**，必须各自成段（`Copyright (c) 2023 rockbenben` / `Copyright (c) 2025 plex`）。 */
        var licIds = [];
        for (var li = 0; li < catalogList.length; li++) {
          var lid = catalogList[li].licenseId || 'UNKNOWN';
          if (licIds.indexOf(lid) < 0) licIds.push(lid);
        }
        for (var lj = 0; lj < licIds.length; lj++) {
          var licEntry = (constants.LICENSES && constants.LICENSES[licIds[lj]]) || null;
          var headName = licEntry && licEntry.name ? licEntry.name : ('许可正文缺失（id=' + licIds[lj] + '）');
          var headSrc = licEntry && licEntry.sourceUrl ? ('，来源 ' + licEntry.sourceUrl) : '';
          lines.push(headName + '（强制保留' + headSrc + '）：');
          lines.push(licEntry ? licEntry.text : '（缺失）');
          lines.push('');
        }
        return {
          ok: true,
          text: lines.join('\n'),
          strongAttributionSourceIds: strong,
          acknowledged: state().licenseAcknowledged === true
        };
      },
      acknowledge: function (version) {
        var res = store.update(function (draft) {
          draft.licenseAcknowledged = true;
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, acknowledged: true, version: text.str(version) || '1', code: null, message: null };
      }
    };

    /* ---------------------------- 导入导出 ---------------------------- */
    var data = {
      exportJSON: function (exportOptions) {
        try {
          var built = storage.buildExport(store, exportOptions);
          if (!built.ok) return built;
          return { ok: true, payload: built.payload, fileName: built.fileName, json: JSON.stringify(built.payload, null, 2), code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '导出失败：' + ((e && e.message) || 'unknown') };
        }
      },
      importJSON: function (input, importOptions) {
        var o = importOptions && typeof importOptions === 'object' ? importOptions : {};
        var mode = o.mode === 'merge' ? 'merge' : 'replace';
        var parsed = storage.parseImport(input);
        if (!parsed.ok) return parsed;
        var incoming = parsed.state;
        var res;
        if (mode === 'replace') {
          res = store.update(function (draft) {
            draft.favorites = incoming.favorites;
            draft.customs = incoming.customs;
            draft.tags = incoming.tags;
            draft.sources = incoming.sources;
            if (o.keepSettings !== true) draft.settings = incoming.settings;
            return draft;
          });
        } else {
          res = store.update(function (draft) {
            var byUid = {};
            var i;
            for (i = 0; i < (draft.favorites || []).length; i++) byUid[draft.favorites[i].uid] = true;
            for (i = 0; i < incoming.favorites.length; i++) {
              if (!byUid[incoming.favorites[i].uid]) { draft.favorites.push(incoming.favorites[i]); byUid[incoming.favorites[i].uid] = true; }
            }
            var byUid2 = {};
            for (i = 0; i < (draft.customs || []).length; i++) byUid2[draft.customs[i].uid] = true;
            for (i = 0; i < incoming.customs.length; i++) {
              if (!byUid2[incoming.customs[i].uid]) { draft.customs.push(incoming.customs[i]); byUid2[incoming.customs[i].uid] = true; }
            }
            var tagSet = (draft.tags || []).slice(0);
            for (i = 0; i < incoming.tags.length; i++) if (tagSet.indexOf(incoming.tags[i]) < 0) tagSet.push(incoming.tags[i]);
            draft.tags = tagSet;
            var srcIds = {};
            for (i = 0; i < (draft.sources || []).length; i++) srcIds[draft.sources[i].id] = true;
            for (i = 0; i < incoming.sources.length; i++) {
              if (!srcIds[incoming.sources[i].id]) draft.sources.push(incoming.sources[i]);
            }
            return draft;
          });
        }
        if (!res.ok) return res;
        return {
          ok: true,
          mode: mode,
          stats: parsed.stats,
          warnings: [],
          code: null,
          message: mode === 'merge' ? '已合并导入（同 uid 的条目保留本地版本）。' : '已覆盖导入（原有收藏/自建/标签被替换）。'
        };
      },
      /* 浏览器侧：把导出包存成文件（不依赖任何 Node API） */
      downloadExport: function (fileName) {
        try {
          var built = data.exportJSON({ includeCache: false });
          if (!built.ok) return built;
          if (typeof document === 'undefined' || typeof Blob !== 'function' || typeof URL === 'undefined') {
            return {
              ok: false,
              code: ERR.UNSUPPORTED,
              message: '当前环境不支持文件下载，请改用 exportJSON() 复制 JSON 文本。',
              json: built.json,
              fileName: built.fileName
            };
          }
          var blob = new Blob([built.json], { type: 'application/json;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = text.str(fileName) || built.fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
            try { document.body.removeChild(a); } catch (e2) { /* 忽略 */ }
          }, 0);
          return { ok: true, fileName: a.download, bytes: text.utf8Bytes(built.json), code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '下载导出文件失败：' + ((e && e.message) || 'unknown') };
        }
      },
      /* 浏览器侧：读取 File/Blob 或 FileReader 结果文本 */
      readFileText: function (file) {
        if (!file) return Promise.resolve({ ok: false, code: ERR.BAD_INPUT, message: '未提供文件。' });
        if (typeof file === 'string') return Promise.resolve({ ok: true, text: file });
        if (typeof FileReader !== 'function') {
          return Promise.resolve({ ok: false, code: ERR.UNSUPPORTED, message: '当前环境不支持 FileReader，请改用文本粘贴导入。' });
        }
        return new Promise(function (resolve) {
          try {
            var reader = new FileReader();
            reader.onload = function () {
              resolve({ ok: true, text: text.str(reader.result) });
            };
            reader.onerror = function () {
              resolve({ ok: false, code: ERR.STORAGE, message: '读取文件失败（FileReader error）。' });
            };
            reader.readAsText(file, 'utf-8');
          } catch (e) {
            resolve({ ok: false, code: ERR.STORAGE, message: '读取文件失败：' + ((e && e.message) || 'unknown') });
          }
        });
      },
      /* 一键：读文件 → 导入（默认 merge，最不易误伤用户数据） */
      importFromFile: function (file, importOptions) {
        return data.readFileText(file).then(function (r) {
          if (!r.ok) return r;
          return data.importJSON(r.text, importOptions);
        });
      }
    };

    /* ---------------------------- 状态与诊断 ---------------------------- */
    var diag = {
      initReport: function () { return initReport ? text.cloneJSON(initReport) : null; },
      storeStatus: function () { return { ok: true, status: store.status() }; },
      resetStore: function () { return store.reset('用户显式重置'); },
      warnings: function () { return { ok: true, warnings: store.status().warnings || [] }; },
      /* 给 verifier 的即时体检：不联网也能跑 */
      selfDescribe: function () {
        var s = state();
        var cat = sourcesMod.catalog(s, sourceStatus);
        return {
          appId: constants.APP_ID,
          dataApiMajor: constants.DATA_API_MAJOR,
          schemaVersion: storage.CURRENT_SCHEMA,
          storeBackend: store.backendReport.kind,
          storeDurable: store.backendReport.durable === true,
          readOnly: store.status().readOnly === true,
          sources: cat.map(function (x) {
            return { id: x.id, kind: x.kind, url: x.url, fallbackUrl: x.fallbackUrl, licenseId: x.licenseId, enabled: x.enabled };
          }),
          filterEnabled: !(s.settings && s.settings.filter && s.settings.filter.enabled === false),
          counts: {
            favorites: (s.favorites || []).length,
            customs: (s.customs || []).length,
            tags: (s.tags || []).length,
            sources: cat.length
          }
        };
      }
    };

    return {
      /* 生命周期 */
      init: init,
      /* 核心检索 */
      search: search,
      /* 子模块 */
      fav: fav,
      favorites: fav,
      custom: custom,
      tags: tags,
      sources: sourcesApi,
      settings: settingsApi,
      filter: filterApi,
      licenses: licensesApi,
      data: data,
      diag: diag,
      /* 直通（给 verifier 做低层断言用） */
      store: store,
      state: state
    };
  }

  core.api = {
    createDataLayer: createDataLayer,
    itemMatches: itemMatches,
    sortItems: sortItems,
    /* 便捷单例：UI 可直接用，也可自建隔离实例 */
    shared: null,
    getShared: function (options) {
      if (!core.api.shared) core.api.shared = createDataLayer(options || {});
      return core.api.shared;
    }
  };
})(__pmCore);
