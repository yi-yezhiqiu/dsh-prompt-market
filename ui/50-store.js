/* ==== unit: ui-store ==== */
/* 提示词市场 · UI 单元 50 —— 跨槽位状态（按钮与面板是**两棵 React 树**，不能用 context）。
 *
 * 约定：模块级 store + 订阅；不使用 React.useSyncExternalStore（本 lane 的 React 版本未知），
 * 用 useEffect + useState 兜底订阅。
 */
(function (ns) {
  'use strict';

  ns.createStore = function (initial) {
    var state = initial && typeof initial === 'object' ? initial : {};
    var listeners = [];
    return {
      getState: function () { return state; },
      setState: function (patch) {
        var next = {};
        var k;
        for (k in state) if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
        if (patch && typeof patch === 'object') {
          for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
        }
        state = next;
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](state); } catch (e) { /* 订阅者异常不影响其它订阅者 */ }
        }
        return state;
      },
      subscribe: function (fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () {
          var idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }
    };
  };

  ns.store = ns.createStore({
    panelOpen: false,          /* 面板可见性（按钮与面板共享） */
    tab: 'market',             /* market | favorites | mine | sources */
    q: '',
    category: '',              /* 分类筛选（标签） */
    sort: 'weight',            /* weight | title */
    page: 1,
    pageSize: 60,
    loading: false,
    listError: null,           /* { code, message } */
    items: [],
    total: 0,
    hasMore: false,
    filteredCount: 0,
    filterStats: null,
    degraded: false,
    sourcesStatus: null,
    detail: null,
    editing: null,             /* { mode:'create'|'edit', uid, title, content, tags } */
    initReport: null,
    notices: null,
    licenses: null,
    filterInfo: null,
    sources: [],
    diag: null,
    uiWriteModes: [],
    writeMode: 'insert',
    writeField: '',            /* 不硬编码默认值：由 A.loadSettings / ns.data.writeField() 按数据层返回值填充（评审 F-6） */
    lastWrite: null,           /* 最近一次写入/替换/拒绝的报告（页面可见，verifier 取证用） */
    lastProbe: null,
    showNotice: false,
    cacheStats: null,
    sourceTest: null,
    listErrors: [],
    toast: null
  });

  ns.useStore = function () {
    var R = ns.React;
    if (!R) return ns.store.getState();
    var pair = R.useState(ns.store.getState());
    var snapshot = pair[0];
    var setSnapshot = pair[1];
    R.useEffect(function () {
      return ns.store.subscribe(function (s) { setSnapshot(s); });
    }, []);
    return snapshot;
  };
})(__pmUi);
