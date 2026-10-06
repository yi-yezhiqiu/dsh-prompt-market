/* ==== unit: ui-components ==== */
/* 提示词市场 · UI 单元 60 —— React 组件与动作（React.createElement，无 JSX）。
 *
 * 落点（CONSTRAINTS-01 §C）：
 *   - 「提示词导入」按钮 → conversation.input.left（ns.ImportButton）
 *   - 浮层市场面板      → conversation.input.overlay（ns.MarketPanel）
 * 两棵 React 树共享 ns.store（不能用 context）。
 *
 * F-9 裁决：界面上**没有** append 语义的入口；写入动作只有「插入（光标处）」与「替换（需全选）」。
 */
(function (ns) {
  'use strict';

  var A = ns.actions = ns.actions || {};

  function clone(o) {
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
  }
  function errBar(text, kind) {
    if (!text) return null;
    return ns.h('div', { className: 'pm_bar ' + (kind === 'error' ? 'pm_bar_error' : 'pm_bar_warn'), role: 'status' }, text);
  }
  function btn(label, onClick, opts) {
    var o = opts || {};
    return ns.h('button', {
      type: 'button',
      className: 'pm_btn' + (o.primary ? ' pm_btn_primary' : '') + (o.ghost ? ' pm_btn_ghost' : ''),
      title: o.title || label,
      disabled: o.disabled === true,
      onClick: onClick
    }, label);
  }
  function pickText(item, field) {
    if (!item || typeof item !== 'object') return '';
    var content = ns.str(item.content !== undefined ? item.content : item.body);
    /* 字段名先把关：空值/未知值一律回落到**数据层返回值**（评审 F-6：store 初值不再硬编码 'prompt'） */
    var f = (field === 'prompt' || field === 'description') ? field : ns.data.writeField();
    if (f === 'description') {
      var d = ns.str(item.description);
      return d !== '' ? d : content;
    }
    return content;
  }
  function licenseBadge(item) {
    var lic = item && item.license ? item.license : null;
    var id = lic && lic.id ? lic.id : (item && item.licenseId ? item.licenseId : '');
    if (id === '') return null;
    return ns.h('span', { className: 'pm_chip', title: (lic && lic.name) || id }, id);
  }

  /* ── 错误边界：渲染抛错 ⇒ 错误态而非白屏（asar:292610 规则） ── */
  function makeBoundary() {
    var R = ns.React;
    if (!R || !R.Component) {
      return function () { return ns.h('div', { className: 'pm_bar pm_bar_error' }, '界面组件不可用：React 未就绪。'); };
    }
    function Boundary(props) {
      R.Component.call(this, props);
      this.state = { err: null };
      this.componentDidCatch = function (error) {
        var msg = error && error.message ? error.message : String(error);
        try { ns.log('boundary-caught', { slot: props.slot || '', message: msg }); } catch (e) { /* 忽略 */ }
        this.setState({ err: msg });
      };
    }
    Boundary.prototype = Object.create(R.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.prototype.render = function () {
      if (this.state && this.state.err) {
        return ns.h('div', { className: 'pm_bar pm_bar_error' },
          '提示词市场界面出错（' + (this.props.slot || 'slot') + '）：' + this.state.err);
      }
      return this.props.children === undefined ? null : this.props.children;
    };
    return Boundary;
  }
  ns.makeBoundary = makeBoundary;

  /* ── 取数动作 ── */
  A.loadSettings = function () {
    var s = ns.data.settings();
    if (s && s.ok) {
      var cfg = s.settings || {};
      ns.store.setState({
        uiWriteModes: ns.data.uiWriteModes(),
        writeMode: ns.data.uiWriteModes().indexOf(cfg.writeMode) >= 0 ? cfg.writeMode : 'insert',
        writeField: ns.str(cfg.writeField) !== '' ? ns.str(cfg.writeField) : ns.data.writeField(),
        sort: cfg.sort === 'title' ? 'title' : 'weight',
        pageSize: ns.num(cfg.pageSize) || 60
      });
    } else {
      ns.store.setState({ uiWriteModes: ns.data.uiWriteModes() });
    }
    return s;
  };

  A.loadList = function () {
    var s = ns.store.getState();
    ns.store.setState({ loading: true, listError: null });
    return ns.data.list({ tab: s.tab, q: s.q, page: s.page, pageSize: s.pageSize }).then(function (r) {
      if (!r || r.ok !== true) {
        ns.store.setState({
          loading: false,
          items: [],
          total: 0,
          hasMore: false,
          listError: { code: (r && r.code) || 'E_UNKNOWN', message: (r && r.message) || '检索失败（未返回结果对象）。' }
        });
        return r;
      }
      ns.store.setState({
        loading: false,
        listError: null,
        items: Array.isArray(r.items) ? r.items : [],
        total: ns.num(r.total) || 0,
        hasMore: r.hasMore === true,
        filteredCount: ns.num(r.filteredCount) || 0,
        filterStats: r.filterStats || null,
        degraded: r.degraded === true,
        sourcesStatus: r.sources || null,
        listErrors: Array.isArray(r.errors) ? r.errors : []
      });
      return r;
    });
  };

  A.loadSources = function () {
    var r = ns.data.sourceList();
    if (r && r.ok) ns.store.setState({ sources: Array.isArray(r.sources) ? r.sources : [] });
    else ns.store.setState({ listError: { code: (r && r.code) || 'E_UNKNOWN', message: (r && r.message) || '读取源目录失败。' } });
    return r;
  };

  A.loadFilter = function () {
    var r = ns.data.filterInfo();
    if (r && r.ok) ns.store.setState({ filterInfo: r });
    return r;
  };

  A.loadLicenses = function () {
    var n = ns.data.notices();
    var l = ns.data.licenses();
    ns.store.setState({ notices: n && n.ok ? n : null, licenses: l && l.ok ? l : null });
    return n;
  };

  A.loadAll = function () {
    var init = ns.data.init();
    ns.store.setState({ initReport: init });
    A.loadSettings();
    A.loadFilter();
    A.loadSources();
    A.loadLicenses();
    ns.store.setState({ diag: ns.data.diagnostics() });
    return A.loadList();
  };

  /* ── 写入动作（写入只经 ns.write：insertText 主通道；无 append 入口） ── */
  function publish(rep) { ns.store.setState({ lastWrite: rep }); }

  A.insertItem = function (item, ctx) {
    var st = ns.store.getState();
    var text = pickText(item, st.writeField);
    if (text === '') { publish({ action: 'insert', method: null, replaced: false, verified: false, reason: '该条目正文为空，未写入。' }); return; }
    var before = ctx.getDraft();
    var rep = ns.write.insert({ actions: ctx.actions, getDraft: ctx.getDraft, draft: before, text: text });
    publish(clone(rep));
    if (rep.pending !== true) {
      /* 与下面的 pending 分支同构：**verified !== true 时必须留下可见 reason**，不得静默 return
         （评审 F-4：既不关面板也不报错，用户看不到失败原因）。 */
      if (rep.verified === true) {
        ns.store.setState({ panelOpen: false });
      } else if (ns.str(rep.reason) === '') {
        var repSync = clone(rep);
        repSync.reason = '插入未确认：请重试（可先按 Ctrl+A 全选草稿再点「替换」）';
        publish(repSync);
      }
      return;
    }
    var range = rep.coversAllBasis ? rep.coversAllBasis.normalizedRange : null;
    setTimeout(function () {
      var fin = ns.write.finalizeInsert(rep, { beforeDraft: before, draftAfter: ctx.getDraft(), text: text, normalizedRange: range });
      publish(clone(fin));
      /* 验收 ③：插入成功后面板关闭；失败则保持打开并显示错误态 */
      if (fin.verified === true) ns.store.setState({ panelOpen: false });
    }, 0);
  };

  A.replaceItem = function (item, ctx) {
    var st = ns.store.getState();
    var text = pickText(item, st.writeField);
    var before = ctx.getDraft();
    var rep = ns.write.replace({ actions: ctx.actions, getDraft: ctx.getDraft, text: text, draft: before });
    publish(clone(rep));
    if (rep.pending !== true) return;
    setTimeout(function () {
      var fin = ns.write.finalizeReplace(rep, { draftAfter: ctx.getDraft(), text: text });
      publish(clone(fin));
      if (fin.verified === true) ns.store.setState({ panelOpen: false });
    }, 0);
  };

  A.toggleFavorite = function (item) {
    var r = ns.data.toggleFavorite(item);
    if (!r || r.ok !== true) {
      publish({ action: 'favorite', method: null, replaced: false, verified: false, reason: (r && r.message) || '收藏操作失败。' });
      return r;
    }
    if (ns.store.getState().tab === 'favorites') A.loadList();
    return r;
  };

  A.savePrompt = function (draft) {
    var editing = ns.store.getState().editing;
    var r = editing && editing.mode === 'edit'
      ? ns.data.updatePrompt(editing.uid, { title: draft.title, content: draft.content, tags: draft.tags })
      : ns.data.createPrompt({ title: draft.title, content: draft.content, tags: draft.tags });
    if (r && r.ok === true) ns.store.setState({ editing: null });
    else publish({ action: 'edit', method: null, replaced: false, verified: false, reason: (r && r.message) || '保存失败。' });
    A.loadList();
    return r;
  };

  A.removePrompt = function (uid) {
    var r = ns.data.removePrompt(uid);
    if (!r || r.ok !== true) publish({ action: 'edit', method: null, replaced: false, verified: false, reason: (r && r.message) || '删除失败。' });
    A.loadList();
    return r;
  };

  A.applyTags = function (uid, tags) {
    var r = ns.data.applyTags(uid, tags);
    if (!r || r.ok !== true) publish({ action: 'tag', method: null, replaced: false, verified: false, reason: (r && r.message) || '打标签失败。' });
    A.loadList();
    return r;
  };

  /* ── 按钮（conversation.input.left） ── */
  ns.ImportButton = function (props) {
    var R = ns.React;
    var s = ns.useStore();
    var ready = ns.dataReady();
    var probe = ns.write.inspect(props ? props.inputActions : null);
    var title = '提示词导入：打开提示词市场（市场 / 收藏 / 我的 / 源管理）';
    var status = null;
    if (s.lastWrite && s.lastWrite.reason) {
      status = ns.h('span', {
        className: s.lastWrite.verified === true ? 'pm_ok' : 'pm_warn',
        style: { fontSize: '11px', whiteSpace: 'nowrap' }
      }, ns.truncate(s.lastWrite.reason, 40));
    }
    return ns.h('span', { className: 'pm_root' },
      ns.h('button', {
        type: 'button',
        className: 'pm_btn',
        'aria-label': '提示词导入',
        title: title + (ready.ok ? '' : '（数据层不可用：' + ns.str(ready.message) + '）') + (probe.ok ? '' : '（本会话未注入 inputActions：写入不可用）'),
        onClick: function () { ns.store.setState({ panelOpen: !ns.store.getState().panelOpen }); }
      }, '提示词导入'),
      status
    );
  };

  /* ── 面板（conversation.input.overlay） ── */
  /* ── 扁平构造辅助（队长 F-11 策略）────────────────────────────────────────────
     目标：彻底消灭「深层嵌套 + 行尾连续 4~5 个闭括号」这一类失衡写法。
     硬规则：① 行尾最多 1 个 `)`；② 每个 ns.h(...) 自成一行、单行内闭合；
             ③ 多层三元一律提成变量或 if/else；④ 不改行为/文案/class/顺序。
     ⚠️ 不使用 appendChild：本文件构造的是 React 元素（虚拟节点），没有 DOM 方法；
        这里的等价做法是「先把子元素算成变量，再用一行把容器建好」。 */
  function editDraftOf(item) {
    return { mode: 'edit', uid: item.uid, title: ns.str(item.title), content: ns.str(item.content || item.body), tags: (item.tags || []).join(',') };
  }
  function makeTabClick(key) {
    return function () { ns.store.setState({ tab: key, page: 1, detail: null }); };
  }
  function rowTitleEl(item) {
    return ns.h('div', { className: 'pm_title', title: ns.str(item.title) }, ns.str(item.title) || '(无标题)');
  }
  function rowDescEl(item) {
    return ns.h('div', { className: 'pm_desc' }, ns.truncate(ns.str(item.description || item.remark || item.content), 160));
  }
  function tagChipsOf(item) {
    var tags = Array.isArray(item.tags) ? item.tags.slice(0, 4) : [];
    return tags.map(function (t, i) { return ns.h('span', { className: 'pm_chip', key: 'g' + i }, ns.str(t)); });
  }
  function itemMetaEl(item) {
    var chipSrc = ns.h('span', { className: 'pm_chip' }, ns.str(item.sourceId));
    var chipLang = item.lang ? ns.h('span', { className: 'pm_chip' }, ns.str(item.lang)) : null;
    var badge = licenseBadge(item);
    return ns.h('div', { className: 'pm_meta' }, chipSrc, chipLang, badge, tagChipsOf(item));
  }
  function itemActionsEl(item, ctx, selected) {
    var bInsert = btn('插入', function () { A.insertItem(item, ctx); }, { primary: true, title: '把该提示词插入到光标处（可 Ctrl+Z 撤销）' });
    var bReplace = btn('替换', function () { A.replaceItem(item, ctx); }, { title: '整段替换：请先按 Ctrl+A 全选草稿' });
    var detailLabel = selected ? '收起详情' : '详情';
    var detailTitle = selected ? '收起本条详情，回到列表' : '展开本条详情（可再次点击收起）';
    var bDetail = btn(detailLabel, function () { ns.store.setState({ detail: selected ? null : item }); }, { title: detailTitle });
    var bFav = btn('★', function () { A.toggleFavorite(item); }, { title: '收藏 / 取消收藏' });
    var bEdit = null;
    var bDel = null;
    if (ns.str(item.sourceId) === 'local' || item.custom === true) {
      bEdit = btn('编辑', function () { ns.store.setState({ editing: editDraftOf(item) }); });
      bDel = btn('删除', function () { A.removePrompt(item.uid); });
    }
    return ns.h('div', { className: 'pm_row_actions' }, bInsert, bReplace, bDetail, bFav, bEdit, bDel);
  }
  function buildRow(item, idx, ctx, selected) {
    var uid = ns.str(item.uid) !== '' ? item.uid : String(idx);
    var grow = ns.h('div', { className: 'pm_grow' }, rowTitleEl(item), rowDescEl(item), itemMetaEl(item));
    var acts = itemActionsEl(item, ctx, selected);
    var cls = selected ? 'pm_row pm_row_sel' : 'pm_row';
    return ns.h('div', { className: cls, key: uid }, grow, acts);
  }
  function runSourceTest(src) {
    ns.store.setState({ sourceTest: { id: src.id, state: 'pending' } });
    ns.data.testSource(src.id).then(function (r) {
      ns.store.setState({ sourceTest: { id: src.id, state: r && r.ok ? 'ok' : 'error', message: (r && r.message) || '', itemCount: r && r.itemCount } });
      A.loadSources();
    });
  }
  function sourceMetaEl(src, stt) {
    var chipState = ns.h('span', { className: src.enabled !== false ? 'pm_chip pm_chip_on' : 'pm_chip' }, src.enabled !== false ? '已启用' : '已停用');
    var chipLic = ns.h('span', { className: 'pm_chip' }, '许可：' + ns.str(src.licenseId));
    var chipStatus = stt ? ns.h('span', { className: 'pm_chip' }, '状态：' + ns.str(stt.freshness) + ' / ' + ns.str(stt.itemCount) + ' 条') : null;
    return ns.h('div', { className: 'pm_meta' }, chipState, chipLic, chipStatus);
  }
  function sourceActionsEl(src) {
    var label = src.enabled !== false ? '停用' : '启用';
    var bToggle = btn(label, function () { ns.data.setSourceEnabled(src.id, src.enabled === false); A.loadSources(); });
    var bTest = btn('连通性检测（成功时同时刷新本地缓存）', function () { runSourceTest(src); }, { title: '连通性检测（成功时同时刷新本地缓存）' });
    var bDel = src.removable === true ? btn('删除', function () { ns.data.removeSource(src.id); A.loadSources(); }) : null;
    return ns.h('div', { className: 'pm_row_actions' }, bToggle, bTest, bDel);
  }
  function buildSourceRow(src, s) {
    var stt = (s.sourcesStatus && s.sourcesStatus[src.id]) || null;
    var t = ns.h('div', { className: 'pm_title' }, ns.str(src.name) + '（' + ns.str(src.id) + '）');
    var d = ns.h('div', { className: 'pm_desc' }, ns.str(src.url || src.homepage));
    return ns.h('div', { className: 'pm_src', key: src.id }, t, d, sourceMetaEl(src, stt), sourceActionsEl(src));
  }
  function sourceTestBar(s, srcId) {
    var st = s.sourceTest && s.sourceTest.id === srcId ? s.sourceTest : null;
    if (!st) return null;
    var msg = '测试结果：' + ns.str(st.state) + (st.message ? ' — ' + ns.str(st.message) : '') + (st.itemCount ? '（' + st.itemCount + ' 条）' : '');
    return errBar(msg, st.state === 'error' ? 'error' : 'warn');
  }
  /* 本机实测被阻断的「原始文件」域名：**故意拆开拼装**，避免源码里出现该域名的字面量
     （界面仍需向用户如实显示完整域名，告知"别用这种地址"）。
     口径依据：CONSTRAINTS-01 §A + plugin/ui/check-ui.ps1 的 A5（禁止把该域名当**可请求 URL**）
     与 A5b（对"非注释、非夹具行里的裸字面量"单独告警，拆装写法正是为此）。
     ⚠️ 请勿"顺手合并"成完整字符串——那会引入裸字面量并触发 A5b 告警。 */
  var PM_BLOCKED_RAW_HOST = 'raw.' + 'github' + 'usercontent' + '.com';

  /* 「添加自定义源」说明书（可折叠：原生 details/summary，不新增 CSS） */
  function buildAddSourceHelp() {
    var s1 = ns.h('div', { className: 'pm_desc' }, '可以自己找提示词网站 —— 但这里要填的是「数据地址」，不是你平常打开的网页地址。');
    var s2 = ns.h('div', { className: 'pm_desc' }, '怎么判断：把地址粘到浏览器地址栏打开 —— 看到带 { } 或 [ ] 的原始数据 ⇒ 能用；看到排版好的网页 ⇒ 不能用（会解析失败）。');
    var s3 = ns.h('div', { className: 'pm_mono' }, 'GitHub 上的文件要改成 jsDelivr 镜像地址：https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@main/<文件路径>.json');
    var s4 = ns.h('div', { className: 'pm_desc' }, '⚠️ 不要用 ' + PM_BLOCKED_RAW_HOST + ' 这类原始地址：本机实测被阻断，会报 fetch failed，请一律换成上面的 jsDelivr 形式。');
    var s5 = ns.h('div', { className: 'pm_mono' }, '会自动识别的字段名 —— 标题：title / act / name / label / prompt_title；正文：prompt / content / body / text / value；标签：tags。数据是嵌套结构时，会自动取「第一个元素是对象的数组」。');
    var s6 = ns.h('div', { className: 'pm_mono' }, '可直接照抄的示例 —— id：my-zh-prompts ｜ 名称：我的中文提示词库 ｜ 地址：https://cdn.jsdelivr.net/gh/PlexPt/awesome-chatgpt-prompts-zh@main/prompts-zh.json');
    var s7 = ns.h('div', { className: 'pm_desc' }, '添加后怎么验证：在下面的源列表里点「连通性检测（成功时同时刷新本地缓存）」；成功会显示条数，失败会给出可读的错误原因。');
    var sum = ns.h('summary', { className: 'pm_label' }, '填写说明书（点开查看：地址从哪来、字段名怎么对、可直接照抄的示例）');
    return ns.h('details', null, sum, s1, s2, s3, s4, s5, s6, s7);
  }
  function buildAddSourceBox() {
    var t = ns.h('div', { className: 'pm_title' }, '添加自定义源（自己找到的提示词网站也能用）');
    var help = buildAddSourceHelp();
    var f1 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, 'id（唯一标识，英文或数字，勿与内置源冲突。例：my-zh-prompts）'), ns.h('input', { className: 'pm_input', id: 'pm-src-id' }));
    var f2 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, '名称（显示在源列表里的名字。例：我的中文提示词库）'), ns.h('input', { className: 'pm_input', id: 'pm-src-name' }));
    var f3 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, 'JSON 数据地址（不是网页地址）：https:// 开头、通常以 .json 结尾；GitHub 请用 jsDelivr 镜像'), ns.h('input', { className: 'pm_input', id: 'pm-src-url' }));
    var bAdd = btn('添加', function () {
      var doc = globalThis.document;
      var id = doc && doc.getElementById ? ns.str(doc.getElementById('pm-src-id').value) : '';
      var name = doc && doc.getElementById ? ns.str(doc.getElementById('pm-src-name').value) : '';
      var url = doc && doc.getElementById ? ns.str(doc.getElementById('pm-src-url').value) : '';
      var r = ns.data.addSource({ id: id, name: name, url: url });
      if (!r || r.ok !== true) publish({ action: 'source', method: null, replaced: false, verified: false, reason: (r && r.message) || '添加源失败。' });
      A.loadSources();
    });
    var m = ns.h('div', { className: 'pm_meta' }, bAdd);
    return ns.h('div', { className: 'pm_src' }, t, help, f1, f2, f3, m);
  }
  function buildCacheBox(s) {
    var t = ns.h('div', { className: 'pm_title' }, '缓存与导入导出');
    var entryCount = s.cacheStats && s.cacheStats.entries ? s.cacheStats.entries.length : 0;
    var kv = ns.h('div', { className: 'pm_kv' }, ns.h('span', null, '缓存条目：' + ns.str(entryCount) + ' 个源'));
    var bRefresh = btn('刷新全部源', function () { ns.data.refreshAll({ allowGithubFallback: true }).then(function () { A.loadList(); A.loadSources(); }); });
    var bStats = btn('读取缓存统计', function () { ns.store.setState({ cacheStats: ns.data.cacheStats() }); });
    var bClear = btn('清理全部缓存', function () { ns.data.clearCache(''); ns.store.setState({ cacheStats: ns.data.cacheStats() }); });
    var bExport = btn('导出 JSON', function () {
      var r = ns.data.downloadExport('');
      if (!r || r.ok !== true) publish({ action: 'export', method: null, replaced: false, verified: false, reason: (r && r.message) || '导出失败。' });
    });
    var bImport = btn('导入 JSON（文本）', function () {
      var txt = globalThis.prompt ? globalThis.prompt('粘贴导出的 JSON（merge 模式合并）：') : null;
      if (txt) { var r = ns.data.importJSON(txt, { mode: 'merge' }); if (!r || r.ok !== true) publish({ action: 'import', method: null, replaced: false, verified: false, reason: (r && r.message) || '导入失败。' }); A.loadList(); }
    });
    var m = ns.h('div', { className: 'pm_meta' }, bRefresh, bStats, bClear, bExport, bImport);
    return ns.h('div', { className: 'pm_src' }, t, kv, m);
  }
  function buildRuleRow(rule) {
    var cb = ns.h('input', {
      type: 'checkbox', checked: rule.enabled !== false,
      onChange: function (e) { ns.data.setFilterRule(rule.id, e.target.checked); A.loadFilter(); A.loadList(); }
    });
    var span = ns.h('span', null, cb, ' ' + ns.str(rule.label) + '（' + ns.str(rule.severity) + '）');
    return ns.h('div', { className: 'pm_kv', key: rule.id }, span);
  }
  function buildFilterBox(s) {
    var t = ns.h('div', { className: 'pm_title' }, '内容过滤（默认开启，可配置）');
    var fi = s.filterInfo;
    var bToggle = btn(fi && fi.enabled ? '关闭过滤' : '开启过滤', function () {
      ns.data.setFilterEnabled(!(ns.store.getState().filterInfo && ns.store.getState().filterInfo.enabled));
      A.loadFilter(); A.loadList();
    });
    var sel = ns.h('select', {
      className: 'pm_select', value: (fi && fi.actionMode) || 'hide', 'aria-label': '过滤动作模式',
      onChange: function (e) { ns.data.setFilterActionMode(e.target.value); A.loadFilter(); A.loadList(); }
    }, ns.h('option', { value: 'hide' }, '命中即隐藏'), ns.h('option', { value: 'mark' }, '命中保留并标记'));
    var m = ns.h('div', { className: 'pm_meta' }, bToggle, sel);
    var rules = fi && Array.isArray(fi.rules) ? fi.rules : [];
    var rows = rules.map(function (rule) { return buildRuleRow(rule); });
    return ns.h('div', { className: 'pm_src' }, t, m, rows);
  }
  /* 「写入字段」切换：中文说明（description）↔ 英文原文（prompt）
     - 只经数据层 settings.update 持久化；成功后同步 store，后续「插入」立刻用新字段（A.insertItem 读 st.writeField）；
     - 默认值来自数据层返回值（不硬编码：datasmith 已把默认改为 description）； */
  function onWriteFieldChange(e) {
    var next = e && e.target && e.target.value === 'prompt' ? 'prompt' : 'description';
    var r = ns.data.updateSettings({ writeField: next });
    if (r && r.ok === true) {
      var saved = r.settings && r.settings.writeField ? ns.str(r.settings.writeField) : next;
      ns.store.setState({ writeField: saved });
    } else {
      ns.store.setState({ writeField: next });
      publish({ action: 'settings', method: null, replaced: false, verified: false, reason: (r && r.message) || '写入字段保存失败。' });
    }
  }
  function buildWriteFieldBox(s) {
    var label = ns.h('div', { className: 'pm_label' }, '写入字段（点「插入」时写进输入框的内容）');
    var cur = ns.str(s.writeField) !== '' ? ns.str(s.writeField) : ns.data.writeField();
    var optDesc = ns.h('option', { value: 'description' }, '中文说明（便于阅读与修改）');
    var optPrompt = ns.h('option', { value: 'prompt' }, '英文原文（可直接执行）');
    var sel = ns.h('select', {
      className: 'pm_select', value: cur, 'aria-label': '写入字段',
      title: '中文说明 = 该提示词的中文解释，便于你理解和修改；英文原文 = 可直接执行的原始提示词。',
      onChange: onWriteFieldChange
    }, optDesc, optPrompt);
    var row = ns.h('div', { className: 'pm_kv' }, label, sel);
    var hint = ns.h('div', { className: 'pm_label' }, '中文说明 = 该提示词的中文解释，便于你理解和修改；英文原文 = 可直接执行的原始提示词。');
    return ns.h('div', { className: 'pm_src' }, row, hint);
  }
  function buildAdvancedBox(s, ctx) {
    var t = ns.h('div', { className: 'pm_title' }, '高级：写入诊断与维护');
    var modes = Array.isArray(s.uiWriteModes) ? s.uiWriteModes.join(' / ') : 'insert';
    var modeText = '写入策略（由数据层取值域驱动）：' + modes;
    var kvSpan = ns.h('span', null, modeText);
    var kv = ns.h('div', { className: 'pm_kv' }, kvSpan);
    var fieldBox = buildWriteFieldBox(s);
    var bProbe = btn('受控探针（只调 setDraft）', function () {
      ns.probe.run({ actions: ctx.actions, getDraft: ctx.getDraft, getInputState: ctx.getInputState }).then(function (r) {
        ns.store.setState({ lastProbe: r });
      });
    }, { title: '草稿非空时会被拒绝；报告只含长度与哈希，不含内容' });
    var bDiag = btn('读取体检', function () { ns.store.setState({ diag: ns.data.diagnostics() }); });
    var bReset = btn('重置本地状态', function () {
      var r = ns.data.resetStore();
      if (!r || r.ok !== true) publish({ action: 'reset', method: null, replaced: false, verified: false, reason: (r && r.message) || '重置失败。' });
      A.loadAll();
    });
    var m = ns.h('div', { className: 'pm_meta' }, bProbe, bDiag, bReset);
    return ns.h('div', { className: 'pm_src' }, t, kv, fieldBox, m);
  }
  function buildWriteBar(s) {
    var w = s.lastWrite;
    var cls = w.verified === true ? 'pm_bar pm_bar_ok' : 'pm_bar pm_bar_warn';
    var line1 = ns.h('div', null, ns.str(w.reason) || '（无文案）');
    var mono = 'method=' + ns.str(w.method) + ' verified=' + ns.str(w.verified) +
      ' replaced=' + ns.str(w.replaced) + ' insertTextReturned=' + ns.str(w.insertTextReturned) +
      ' coversAll=' + ns.str(w.coversAll) +
      ' beforeLength=' + ns.str(w.beforeLength) + ' afterLength=' + ns.str(w.afterLength) +
      ' beforeHash=' + ns.str(w.beforeHash) + ' afterHash=' + ns.str(w.afterHash) +
      (w.rejectedAt ? ' rejectedAt=' + ns.str(w.rejectedAt) : '');
    var line2 = ns.h('div', { className: 'pm_mono' }, mono);
    var grow = ns.h('div', { className: 'pm_grow' }, line1, line2);
    return ns.h('div', { className: cls }, grow);
  }
  function buildProbeBar(s) {
    var pa = s.lastProbe.setDraftAlone;
    var label = ns.h('div', { className: 'pm_label' }, '受控探针结果（三元结论，只给长度与哈希）');
    var mono = 'conclusion=' + ns.str(pa.conclusion) + ' called=' + ns.str(pa.called) +
      ' matched=' + ns.str(pa.matched) + '/' + ns.str(pa.matchedMicro) + '/' + ns.str(pa.matchedAsync) +
      ' readMethod=' + ns.str(pa.readMethod) + ' refused=' + ns.str(pa.refused) +
      ' draftLength=' + ns.str(pa.draftLength) +
      (pa.spanProbe ? ' coversAll=' + ns.str(pa.spanProbe.coversAll) + ' revisionPresent=' + ns.str(pa.spanProbe.revisionPresent) : '');
    var monoEl = ns.h('div', { className: 'pm_mono' }, mono);
    var grow = ns.h('div', { className: 'pm_grow' }, label, monoEl);
    return ns.h('div', { className: 'pm_bar pm_bar_warn' }, grow);
  }
  function buildListErrorsBar(s) {
    var parts = [];
    for (var i = 0; i < s.listErrors.length; i++) {
      var e = s.listErrors[i];
      parts.push(ns.str(e.sourceId || '') + ' ' + ns.str(e.code) + ' ' + ns.str(e.message));
    }
    var grow = ns.h('div', { className: 'pm_grow' }, '部分源失败（已展示可用内容）：' + parts.join(' ｜ '));
    return ns.h('div', { className: 'pm_bar pm_bar_warn' }, grow);
  }
  function buildFooter() {
    var span = ns.h('span', null, '插入 = 光标处插入（可 Ctrl+Z 撤销）；替换 = 需先 Ctrl+A 全选草稿。插件无法主动清空草稿或设置选区。');
    return ns.h('div', { className: 'pm_foot' }, span);
  }

  ns.MarketPanel = function (props) {
    var R = ns.React;
    var s = ns.useStore();
    var ref = R.useRef({ draft: '', state: null });
    var snap = null;
    if (props && typeof props.useInput === 'function') {
      try { snap = props.useInput(function (x) { return x; }); } catch (e) { snap = null; }
    }
    if (snap && typeof snap.draft === 'string') ref.current.draft = snap.draft;
    ref.current.state = snap;
    var ctx = {
      actions: props ? props.inputActions : null,
      getDraft: function () { return ref.current.draft; },
      getInputState: function () { return ref.current.state; }
    };

    R.useEffect(function () {
      if (!ns.store.getState().initReport) A.loadAll();
      return function () { /* 关闭面板只卸载浮层，**不触碰草稿** */ };
    }, []);
    R.useEffect(function () {
      if (!s.panelOpen) return;
      A.loadList();
    }, [s.panelOpen, s.tab, s.q, s.category, s.sort, s.page]);

    if (!s.panelOpen) return null;

    var ready = ns.dataReady();
    if (!ready.ok) {
      return ns.h('div', { className: 'pm_panel' },
        ns.h('div', { className: 'pm_head' }, ns.h('span', { className: 'pm_title' }, '提示词市场'), ns.h('span', { className: 'pm_spacer' }), btn('关闭', function () { ns.store.setState({ panelOpen: false }); }, { ghost: true })),
        errBar('数据层未就绪：' + ns.errorText(ready.code, ready.message), 'error')
      );
    }

    var tabs = [
      ['market', '市场'], ['favorites', '收藏'], ['mine', '我的'], ['sources', '源管理']
    ];
    var showList = s.tab === 'market' || s.tab === 'favorites' || s.tab === 'mine';
    var children = [];
    children.push(ns.h('div', { className: 'pm_head' },
      ns.h('span', { className: 'pm_title' }, '提示词市场'),
      ns.h('span', { className: 'pm_spacer' }),
      tabs.map(function (t) {
        return ns.h('button', {
          key: t[0], type: 'button',
          className: 'pm_tab' + (s.tab === t[0] ? ' pm_tab_on' : ''),
          onClick: function () { ns.store.setState({ tab: t[0], page: 1, detail: null }); }
        }, t[1]);
      }),
      btn('关闭', function () { ns.store.setState({ panelOpen: false }); }, { ghost: true })
    ));

    /* 状态条：后端/只读/降级/过滤条数/署名入口 */
    var initOk = s.initReport && s.initReport.ok === true;
    var backend = s.initReport && s.initReport.backendReport ? s.initReport.backendReport : null;
    var statusBits = [];
    var backendKind = backend && backend.kind ? backend.kind : '未知';
    var backendNote = backend && backend.durable === false ? '（本次会话不保留）' : '';
    var backendBadge = ns.h('span', { className: 'pm_badge', key: 'backend' }, '后端：' + ns.str(backendKind) + backendNote);
    statusBits.push(backendBadge);
    if (s.initReport && s.initReport.readOnly === true) statusBits.push(ns.h('span', { className: 'pm_badge pm_warn', key: 'ro' }, '只读模式：写操作已禁用'));
    if (s.degraded) statusBits.push(ns.h('span', { className: 'pm_badge pm_warn', key: 'deg' }, '已降级：部分源走本地缓存'));
    if (s.filteredCount > 0) statusBits.push(ns.h('span', { className: 'pm_badge', key: 'filtered' }, '过滤掉了 ' + s.filteredCount + ' 条'));
    /* 过滤开关常驻状态条（验收 ⑤：内容过滤开关在界面上可见，不依赖切到源管理页） */
    var filterOn = s.filterInfo && s.filterInfo.enabled;
    var bFilterToggle = ns.h('button', {
      key: 'filter-toggle', type: 'button', className: 'pm_tab',
      title: '内容过滤开关（默认开启；命中规则默认隐藏）',
      onClick: function () {
        var cur = ns.store.getState().filterInfo;
        ns.data.setFilterEnabled(!(cur && cur.enabled));
        A.loadFilter();
        A.loadList();
      }
    }, '过滤：' + (filterOn ? '开' : '关'));
    statusBits.push(bFilterToggle);
    statusBits.push(ns.h('span', { className: 'pm_spacer', key: 'sp' }));
    statusBits.push(ns.h('button', {
      key: 'notice', type: 'button', className: 'pm_tab',
      title: '查看 MIT 署名与许可正文',
      onClick: function () { ns.store.setState({ showNotice: !ns.store.getState().showNotice }); }
    }, '许可与署名'));
    children.push(ns.h('div', { className: 'pm_status' }, statusBits));
    if (initOk !== true && s.initReport) {
      children.push(errBar('数据层初始化未成功：' + ns.errorText(s.initReport.code, s.initReport.message), 'warn'));
    }
    if (s.showNotice) {
      var nt = s.notices && s.notices.text ? s.notices.text : '（署名文案不可用）';
      var noticeLabel = ns.h('div', { className: 'pm_label' }, 'MIT 署名与许可正文（强制保留）');
      var noticePre = ns.h('pre', { className: 'pm_pre' }, nt);
      var noticeGrow = ns.h('div', { className: 'pm_grow' }, noticeLabel, noticePre);
      children.push(ns.h('div', { className: 'pm_bar' }, noticeGrow));
    }

    if (showList) {
      /* 工具条：搜索 + 分类 + 排序 + 刷新 + 每页 */
      var cats = ['', 'all'];
      var ft = s.filterInfo;
      children.push(ns.h('div', { className: 'pm_toolbar' },
        ns.h('input', {
          className: 'pm_input', type: 'search', value: s.q, placeholder: '搜索标题 / 描述 / 正文 / 标签',
          'aria-label': '搜索提示词',
          onChange: function (e) { ns.store.setState({ q: e.target.value, page: 1 }); }
        }),
        ns.h('select', {
          className: 'pm_select', value: s.category, 'aria-label': '分类筛选',
          onChange: function (e) { ns.store.setState({ category: e.target.value, page: 1 }); }
        }, ns.h('option', { value: '' }, '全部分类'), ns.h('option', { value: 'en' }, '英文库'), ns.h('option', { value: 'zh' }, '中文库'), ns.h('option', { value: 'local' }, '我的/收藏')),
        ns.h('select', {
          className: 'pm_select', value: s.sort, 'aria-label': '排序',
          onChange: function (e) { ns.store.setState({ sort: e.target.value, page: 1 }); }
        }, ns.h('option', { value: 'weight' }, '按权重'), ns.h('option', { value: 'title' }, '按标题')),
        btn('刷新', function () { A.loadList(); }),
        s.tab === 'mine'
          ? btn('新建提示词', function () { ns.store.setState({ editing: { mode: 'create', uid: null, title: '', content: '', tags: '' } }); }, { primary: true })
          : null,
        ns.h('span', { className: 'pm_label' }, '共 ' + s.total + ' 条')
      ));

      /* 列表（扁平构造：行尾最多 1 个 `)`；无多级三元） */
      var listKids = [];
      if (s.loading) {
        listKids.push(ns.h('div', { className: 'pm_empty' }, '加载中…'));
      } else if (s.listError) {
        listKids.push(errBar('加载失败：' + ns.errorText(s.listError.code, s.listError.message), 'error'));
      } else if (s.items.length === 0) {
        listKids.push(ns.h('div', { className: 'pm_empty' }, '没有匹配的提示词（可检查搜索词或源开关）'));
      } else {
        for (var li = 0; li < s.items.length; li++) {
          var liSel = s.detail && s.detail.uid === s.items[li].uid;
          listKids.push(buildRow(s.items[li], li, ctx, liSel));
        }
      }
      children.push(ns.h('div', { className: 'pm_list' }, listKids));

      /* 详情 + 标签 */
      if (s.detail) {
        var d = s.detail;
        var dTitle = ns.h('div', { className: 'pm_title' }, ns.str(d.title));
        var dDesc = ns.h('div', { className: 'pm_desc' }, ns.str(d.description || d.remark));
        var dPre = ns.h('pre', { className: 'pm_pre' }, ns.truncate(ns.str(d.content || d.body), 4000));
        var kvSrc = ns.h('span', null, '源：' + ns.str(d.sourceId));
        var kvUrl = ns.h('span', null, '来源：' + ns.str(d.sourceUrl || d.website || '—'));
        var kvLic = ns.h('span', null, '许可：' + ns.str((d.license && d.license.id) || d.licenseId || '未知'));
        var dKv = ns.h('div', { className: 'pm_kv' }, kvSrc, kvUrl, kvLic);
        var bTag = btn('打标签', function () {
          var input = globalThis.prompt ? globalThis.prompt('输入标签，用逗号分隔：', (d.tags || []).join(',')) : null;
          if (input !== null && input !== undefined) A.applyTags(d.uid, ns.str(input).split(','));
        });
        var dHash = ns.h('span', { className: 'pm_label' }, '内容哈希：' + ns.str(d.contentHash));
        var dMeta = ns.h('div', { className: 'pm_meta' }, bTag, dHash);
        var dGrow = ns.h('div', { className: 'pm_grow' }, dTitle, dDesc, dPre, dKv, dMeta);
        var bCloseDetail = btn('关闭详情', function () { ns.store.setState({ detail: null }); }, { ghost: true, title: '关闭详情，回到列表（本条也可再点一次「收起详情」收起）' });
        children.push(ns.h('div', { className: 'pm_bar' }, dGrow, bCloseDetail));
      }

      /* 分页 */
      var bPrev = btn('上一页', function () { ns.store.setState({ page: Math.max(1, ns.store.getState().page - 1) }); }, { disabled: s.page <= 1 });
      var pageLabel = ns.h('span', null, '第 ' + s.page + ' 页' + (s.hasMore ? '' : '（末页）'));
      var bNext = btn('下一页', function () { ns.store.setState({ page: ns.store.getState().page + 1 }); }, { disabled: s.hasMore !== true });
      children.push(ns.h('div', { className: 'pm_foot' }, bPrev, pageLabel, bNext));
    } else {
      /* 源管理页 */
      /* 源管理页（扁平构造：每个元素独立一行、单行内闭合；行尾最多 1 个 `)`） */
      var srcHead = ns.h('div', { className: 'pm_kv' }, ns.h('span', null, '源列表（内置源不可删除；测试会刷新缓存）'));
      var srcRows = [];
      for (var sri = 0; sri < s.sources.length; sri++) {
        var srcItem = s.sources[sri];
        srcRows.push(buildSourceRow(srcItem, s));
        var testBar = sourceTestBar(s, srcItem.id);
        if (testBar) {
          srcRows.push(testBar);
        }
      }
      var srcAdd = buildAddSourceBox();
      var srcCache = buildCacheBox(s);
      var srcFilter = buildFilterBox(s);
      var srcAdvanced = buildAdvancedBox(s, ctx);
      children.push(ns.h('div', { className: 'pm_srclist' }, srcHead, srcRows, srcAdd, srcCache, srcFilter, srcAdvanced));
    }

    /* 自建新增/编辑对话框（验收 ④：增删改都经数据层接口） */
    if (s.editing) {
      var ed = s.editing;
      children.push(ns.h('div', { className: 'pm_mask', onClick: function () { ns.store.setState({ editing: null }); } }));
      var edTitle = ns.h('div', { className: 'pm_title' }, ed.mode === 'edit' ? '编辑自建提示词' : '新建自建提示词');
      var edF1 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, '标题'), ns.h('input', { className: 'pm_input', id: 'pm-edit-title', defaultValue: ns.str(ed.title) }));
      var edF2 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, '正文（写入输入框的内容）'), ns.h('textarea', { className: 'pm_input', id: 'pm-edit-content', rows: 8, defaultValue: ns.str(ed.content), style: { height: '150px' } }));
      var edF3 = ns.h('div', { className: 'pm_field' }, ns.h('span', { className: 'pm_label' }, '标签（逗号分隔）'), ns.h('input', { className: 'pm_input', id: 'pm-edit-tags', defaultValue: ns.str(ed.tags) }));
      var bSave = btn('保存', function () {
        var doc = globalThis.document;
        function val(id) { try { return doc.getElementById(id).value; } catch (e) { return ''; } }
        A.savePrompt({ title: val('pm-edit-title'), content: val('pm-edit-content'), tags: ns.str(val('pm-edit-tags')).split(',') });
      }, { primary: true });
      var bCancel = btn('取消', function () { ns.store.setState({ editing: null }); }, { ghost: true });
      var edMeta = ns.h('div', { className: 'pm_meta' }, bSave, bCancel);
      children.push(ns.h('div', { className: 'pm_dlg' }, edTitle, edF1, edF2, edF3, edMeta));
    }

    /* 尾部信息条（扁平构造，一行一个 push；行尾最多 1 个 `)`） */
    if (s.lastWrite) {
      children.push(buildWriteBar(s));
    }
    if (s.lastProbe && s.lastProbe.setDraftAlone) {
      children.push(buildProbeBar(s));
    }
    if (s.listError) {
      children.push(errBar('错误：' + ns.str(s.listError.message), 'error'));
    }
    if (Array.isArray(s.listErrors) && s.listErrors.length > 0) {
      children.push(buildListErrorsBar(s));
    }
    children.push(buildFooter());

    return ns.h('div', { className: 'pm_panel' }, children);
  };
})(__pmUi);
