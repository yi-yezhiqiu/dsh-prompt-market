/* ==== unit: ui-data ==== */
/* 提示词市场 · UI 单元 20 —— 数据层适配层（UI 只认这里的方法名）。
 *
 * 纪律：
 *   - 取数**只走** docs/DATA-01-数据层接口.md §2.5 的 bootstrap 入口（`__pmCore.getMarket()` + 便捷方法），
 *     不重复实现拉取/存储/过滤；
 *   - 每个入口都返回结果对象（`{ok, code, message, …}`），**绝不抛未捕获异常**（验收 ⑥：不白屏）；
 *   - 数据层未就绪时读 `globalThis.__pmCoreBrowserError`，不自造原因。
 */
(function (ns) {
  'use strict';

  var D = ns.data = ns.data || {};

  function fail(code, message) { return { ok: false, code: code, message: message }; }

  function norm(r) {
    if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
    return { ok: true, value: r === undefined ? null : r, code: null, message: null };
  }

  /* bootstrap 便捷方法（同步） */
  function via(name, args) {
    var c = ns.core();
    if (!c) return fail('E_NO_CORE', ns.dataReady().message);
    var fn = c[name];
    if (typeof fn !== 'function') return fail('E_NO_API', '数据层便捷方法缺失：' + name);
    try { return norm(fn.apply(c, args || [])); } catch (e) { return fail('E_UI_CALL', name + ' 调用抛错：' + ns.errText(e)); }
  }

  /* bootstrap 便捷方法（Promise；同步抛错也转成 rejected 结果） */
  function viaAsync(name, args) {
    var c = ns.core();
    if (!c) return Promise.resolve(fail('E_NO_CORE', ns.dataReady().message));
    var fn = c[name];
    if (typeof fn !== 'function') return Promise.resolve(fail('E_NO_API', '数据层便捷方法缺失：' + name));
    try {
      return Promise.resolve(fn.apply(c, args || [])).then(function (r) {
        return norm(r);
      }, function (e) {
        return fail('E_NETWORK', name + ' 失败：' + ns.errText(e));
      });
    } catch (e2) {
      return Promise.resolve(fail('E_UI_CALL', name + ' 调用抛错：' + ns.errText(e2)));
    }
  }

  /* market.<sub>.*（bootstrap 未暴露的方法走这里，仍属数据层接口，不重复实现） */
  function subFn(path) {
    var owner = ns.market();
    if (!owner) return null;
    var parts = path.split('.');
    for (var i = 0; i < parts.length - 1; i++) {
      owner = owner[parts[i]];
      if (!owner) return null;
    }
    var fn = owner[parts[parts.length - 1]];
    return typeof fn === 'function' ? { owner: owner, fn: fn } : null;
  }

  function viaSub(path, args) {
    var s = subFn(path);
    if (!s) return fail('E_NO_API', '数据层方法缺失：' + path + '（数据层未就绪或版本不符）');
    try { return norm(s.fn.apply(s.owner, args || [])); } catch (e) { return fail('E_UI_CALL', path + ' 调用抛错：' + ns.errText(e)); }
  }

  function viaSubAsync(path, args) {
    var s = subFn(path);
    if (!s) return Promise.resolve(fail('E_NO_API', '数据层方法缺失：' + path));
    try {
      return Promise.resolve(s.fn.apply(s.owner, args || [])).then(function (r) { return norm(r); }, function (e) {
        return fail('E_NETWORK', path + ' 失败：' + ns.errText(e));
      });
    } catch (e2) {
      return Promise.resolve(fail('E_UI_CALL', path + ' 调用抛错：' + ns.errText(e2)));
    }
  }

  /* 只有这些写入策略在面板里有**实现路径**（F-9 裁决：append 语义的入口已取消 ⇒ 不在列） */
  ns.IMPLEMENTABLE_WRITE_MODES = ['insert'];

  D.ready = function () { return ns.dataReady(); };
  D.init = function () { return via('initOnce', []); };

  D.settings = function () { return via('settings', []); };
  D.writeModes = function () {
    var r = D.settings();
    var s = r && r.settings ? r.settings : (r && r.value ? r.value : null);
    var list = s && s.writeModes;
    return Array.isArray(list) ? list.slice(0) : [];
  };
  /* 白名单过滤：**取值域由数据层单一来源驱动**，UI 只渲染**真正有实现路径**的值；
     数据层将来新增取值时，未列入 IMPLEMENTABLE 的不会被渲染成“可配置但无实现”的陷阱选项。 */
  D.uiWriteModes = function () {
    var list = D.writeModes();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (ns.IMPLEMENTABLE_WRITE_MODES.indexOf(list[i]) >= 0 && out.indexOf(list[i]) < 0) out.push(list[i]);
    }
    if (out.length === 0) out.push('insert');
    return out;
  };
  D.writeField = function () {
    var r = D.settings();
    var s = r && r.settings ? r.settings : null;
    var wf = s && s.writeField;
    /* ① 数据层返回值（settings() 已合并其默认值，核心默认见 plugin/core/constants.js）优先 */
    if (wf === 'prompt' || wf === 'description') return wf;
    /* ② 数据层暂不可用：退回 UI 当前状态（由 A.loadSettings 维护） */
    var st = ns.store && ns.store.getState ? ns.store.getState() : null;
    var cur = st && st.writeField;
    if (cur === 'prompt' || cur === 'description') return cur;
    /* ③ 最后才用与数据层默认一致的 'description'（评审 F-6：不再硬编码旧的 'prompt'） */
    return 'description';
  };
  D.updateSettings = function (patch) { return via('updateSettings', [patch]); };

  D.list = function (query) { return viaAsync('fetchPrompts', [query || {}]); };

  D.favorites = function () { return via('favorites', []); };
  D.toggleFavorite = function (item) { return via('toggleFavorite', [item]); };

  D.myPrompts = function () { return via('myPrompts', []); };
  D.createPrompt = function (input) { return via('createPrompt', [input]); };
  D.updatePrompt = function (uid, patch) { return viaSub('custom.update', [uid, patch]); };
  D.removePrompt = function (uid) { return viaSub('custom.remove', [uid]); };
  D.duplicatePrompt = function (uid) { return viaSub('custom.duplicate', [uid]); };

  D.tags = function () { return viaSub('tags.list', []); };
  D.addTag = function (tag) { return viaSub('tags.add', [tag]); };
  D.renameTag = function (from, to) { return viaSub('tags.rename', [from, to]); };
  D.removeTag = function (tag) { return viaSub('tags.remove', [tag]); };
  D.applyTags = function (uid, tags) { return viaSub('tags.apply', [uid, tags]); };

  D.sourceList = function () { return via('listSources', []); };
  /* ⚠️ testSource 不是纯只读探测：成功时会顺带刷新该源缓存（datasmith 只读复核）；
     UI 文案必须如实写「连通性检测（成功时同时刷新本地缓存）」，不得写成无副作用。 */
  D.testSource = function (id) { return viaAsync('testSource', [id]); };
  D.addSource = function (input) { return via('addSource', [input]); };
  D.removeSource = function (id) { return via('removeSource', [id]); };
  D.setSourceEnabled = function (id, enabled) { return viaSub('sources.setEnabled', [id, enabled]); };
  D.updateSource = function (id, patch) { return viaSub('sources.update', [id, patch]); };
  D.refreshAll = function (opts) { return viaSubAsync('sources.refreshAll', [opts || {}]); };
  D.cacheStats = function () { return viaSub('sources.cacheStats', []); };
  D.clearCache = function (id) { return viaSub('sources.clearCache', [id]); };
  D.sourceStatus = function () { return viaSub('sources.status', []); };

  D.filterInfo = function () { return via('filterInfo', []); };
  D.setFilterEnabled = function (enabled) { return via('setFilterEnabled', [enabled === true]); };
  D.setFilterActionMode = function (mode) { return viaSub('filter.setActionMode', [mode === 'mark' ? 'mark' : 'hide']); };
  D.setFilterRule = function (ruleId, enabled) { return viaSub('filter.setRuleEnabled', [ruleId, enabled === true]); };
  D.setFilterTerms = function (terms) { return viaSub('filter.setCustomTerms', [terms || []]); };
  D.checkText = function (text) { return viaSub('filter.checkText', [text]); };

  D.licenses = function () { return viaSub('licenses.list', []); };
  D.notices = function () { return via('notices', []); };
  D.acknowledgeLicense = function (version) { return viaSub('licenses.acknowledge', [version || '1']); };

  D.exportJSON = function () { return via('exportJSON', []); };
  D.importJSON = function (text, opts) { return via('importJSON', [text, opts || {}]); };
  D.downloadExport = function (fileName) { return viaSub('data.downloadExport', [fileName]); };
  D.importFromFile = function (file, opts) { return viaSubAsync('data.importFromFile', [file, opts || {}]); };

  D.diagnostics = function () { return via('diagnostics', []); };
  D.resetStore = function () { return viaSub('diag.resetStore', []); };
})(__pmUi);
