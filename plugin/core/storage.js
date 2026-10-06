/* =============================================================================
 * plugin/core/storage.js — 版本化本地持久化（localStorage 优先，内存降级）
 * =============================================================================
 * Q1 决策落地（CONSTRAINTS-01 §F-Q1 / DSH-01 §6-Q1）：
 *   载体 = 浏览器 localStorage（零后端、零权限、最贴合目标）；
 *   但**必须**先给出可用性结论并落盘（见 docs/DATA-01-数据层接口.md §6），
 *   且实现必须把「localStorage 不可用」当成**一等公民场景**处理。
 *
 * 设计要点：
 *   1) 探测式获取后端：显式注入 → localStorage（真写一笔哨兵 → 读回 → 删除）
 *      → 内存 Map 后端（可用但 reported=false，UI 必须提示“本次会话不会保留”）。
 *   2) 单根键存储：dsh-prompt-market:state。整份状态一次读、一次写，
 *      避免多键半写导致的不一致。写入前做字节护栏（超限拒绝并回可展示错误）。
 *   3) schemaVersion 与迁移护栏：
 *        - v0（无版本号的旧数据）→ 迁移到 v1；
 *        - v > 当前版本（用户降级过插件）→ **拒绝覆盖**，进入 readOnly，
 *          返回 code=E_SCHEMA，并给出可展示的错误文案（绝不静默清空用户数据）；
 *        - 解析失败 / 结构损坏 → 有界救援（尽量捞出可用条目），并把
 *          原始串留档在 quarantine 键里，绝不无声丢弃。
 *   4) 全部函数不抛未捕获异常；写失败返回 { ok:false, code, message }。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var filter = core.filter || {};

  var KEYS = constants.STORAGE_KEYS || { STATE: 'dsh-prompt-market:state', CACHE_PREFIX: 'dsh-prompt-market:cache:' };
  var LIMITS = constants.LIMITS || {};
  var CURRENT_SCHEMA = constants.SCHEMA_VERSION || 1;
  var STATE_KEY = KEYS.STATE;
  var CACHE_PREFIX = KEYS.CACHE_PREFIX;
  var QUARANTINE_KEY = STATE_KEY + ':quarantine';
  var SENTINEL_KEY = STATE_KEY + ':probe';

  /* ---------------------------------------------------------------------------
   * 1) 后端探测
   * ------------------------------------------------------------------------ */
  function memoryBackend() {
    var map = {};
    var order = [];
    return {
      kind: 'memory',
      usable: true,
      durable: false,
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      },
      setItem: function (k, v) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) order.push(k);
        map[k] = String(v);
        return true;
      },
      removeItem: function (k) {
        if (Object.prototype.hasOwnProperty.call(map, k)) delete map[k];
        return true;
      },
      keys: function () { return order.slice(0); }
    };
  }

  /* 对候选后端做真写—读回—删除探测（不能只用 typeof 判断） */
  function probeBackend(candidate) {
    if (!candidate) return { ok: false, reason: 'missing' };
    try {
      candidate.setItem(SENTINEL_KEY, 'ok');
      var back = candidate.getItem(SENTINEL_KEY);
      candidate.removeItem(SENTINEL_KEY);
      if (back !== 'ok') return { ok: false, reason: 'readback-mismatch' };
      return { ok: true, reason: 'write-read-remove-ok' };
    } catch (e) {
      return { ok: false, reason: (e && e.name) ? e.name : 'threw' };
    }
  }

  function resolveBackend(injected) {
    var report = {
      kind: 'memory',
      durable: false,
      writable: false,
      reason: '',
      source: 'fallback'
    };

    /* a) 显式注入优先（verifier 可用它注入夹具后端做无副作用测试） */
    if (injected) {
      var pi = probeBackend(injected);
      if (pi.ok) {
        report.kind = injected.kind || 'injected';
        report.durable = injected.durable !== false;
        report.writable = true;
        report.reason = 'injected-backend:' + pi.reason;
        report.source = 'injected';
        injected.kind = report.kind;
        injected.durable = report.durable;
        injected.usable = true;
        return { backend: injected, report: report };
      }
      report.reason = 'injected-backend-unusable:' + pi.reason;
      report.source = 'injected-failed';
    }

    /* b) 浏览器 localStorage（零后端零权限的首选） */
    var ls = null;
    try { ls = globalThis.localStorage || null; } catch (e) { ls = null; }
    if (!ls && typeof globalThis.window !== 'undefined' && globalThis.window) {
      try { ls = globalThis.window.localStorage || null; } catch (e2) { ls = null; }
    }
    if (ls) {
      var pl = probeBackend(ls);
      if (pl.ok) {
        ls.kind = 'localStorage';
        ls.durable = true;
        ls.usable = true;
        report.kind = 'localStorage';
        report.durable = true;
        report.writable = true;
        report.reason = pl.reason;
        report.source = 'localStorage';
        return { backend: ls, report: report };
      }
      report.reason = (report.reason ? report.reason + ' | ' : '') + 'localStorage-unusable:' + pl.reason;
    } else {
      report.reason = (report.reason ? report.reason + ' | ' : '') + 'localStorage-absent';
    }

    /* c) 内存降级（可用但不持久化；UI 需提示） */
    var mem = memoryBackend();
    return { backend: mem, report: report };
  }

  /* ---------------------------------------------------------------------------
   * 2) 默认状态与规范化
   * ------------------------------------------------------------------------ */
  function migrateItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var uid = text.str(raw.uid || raw.id);
    if (uid === '') return null;
    var content = text.sanitizeText(raw.content !== undefined ? raw.content : raw.body, {
      maxChars: LIMITS.CONTENT_MAX_CHARS || 20000
    });
    var title = text.sanitizeText(raw.title, { maxChars: LIMITS.TITLE_MAX_CHARS || 300, keepNewlines: false });
    var iso = function (v) {
      var s = text.str(v);
      return s === '' ? text.nowIso() : s;
    };
    return {
      uid: uid,
      id: uid,
      sourceId: text.str(raw.sourceId) || 'local',
      nativeId: text.str(raw.nativeId) || uid,
      title: title.text,
      content: content.text,
      body: content.text,
      tags: Array.isArray(raw.tags) ? raw.tags.map(function (t) { return text.str(t).slice(0, 40); }).slice(0, 20) : [],
      lang: text.str(raw.lang) || 'zh',
      author: raw.author === undefined ? null : text.str(raw.author),
      description: text.sanitizeText(raw.description, { maxChars: 2000 }).text,
      remark: text.sanitizeText(raw.remark, { maxChars: 2000 }).text,
      weight: text.num(raw.weight),
      website: raw.website === undefined ? null : text.str(raw.website),
      sourceUrl: text.str(raw.sourceUrl) || '',
      license: raw.license && typeof raw.license === 'object' ? raw.license : null,
      sanitized: raw.sanitized === true || content.changed,
      contentHash: text.str(raw.contentHash) || text.contentHash(content.text),
      custom: raw.custom === true,
      filtered: raw.filtered === true ? true : undefined,
      createdAt: iso(raw.createdAt),
      updatedAt: iso(raw.updatedAt)
    };
  }

  function defaultState() {
    return {
      schemaVersion: CURRENT_SCHEMA,
      appId: constants.APP_ID || 'dsh-prompt-market',
      updatedAt: text.nowIso(),
      revision: 0,
      appliedMigrations: [],
      licenseAcknowledged: false,
      favorites: [],
      customs: [],
      sources: [],
      tags: [],
      settings: defaultSettings()
    };
  }

  function defaultSettings() {
    var f = filter.defaultSettings ? filter.defaultSettings() : { enabled: true, actionMode: 'hide', customTerms: [], extraRuleIds: [], disabledRuleIds: [] };
    return {
      /* 写入策略（**取值域只有这两个**）：
       *   'insert' = 在光标处插入（默认）
       *   'append' = 追加到草稿末尾（自动补空行）
       *
       * 关于「覆盖整段草稿」的准确能力边界（与 api.js 的错误文案同一口径）：
       *   - 插件**无法主动**清空草稿或设置选区：InputActions 只有
       *     captureInsertion / insertText / setDraft 三个动作；
       *   - **但**用户自己 Ctrl+A 全选后再触发 insertText，就等价于覆盖整段
       *     （insertText 是在**捕获到的选区**上插入）。
       *   ⇒「替换」不是一个可持久化的设置项（所以取值域里没有它，旧配置里的脏值
       *     会在 normalizeSettings 里静默回落 'insert'），**但界面可以在能捕获到
       *     覆盖全文的选区时，把它作为条件动作提供**；捕获不到时如实提示用户先全选。 */
      writeMode: 'insert',
      /* 中文库写入哪个字段（t13 改默认值）：
       *   'description' = 中文说明（**现在的默认**）—— 中文库的 prompt 多为英文原文
       *     （constants.js 的 promptIsMostlyEnglish: true），默认写中文让用户看得懂、可修改；
       *   'prompt'      = 可直接执行的原文（英文为主），保留给用户显式切回。
       * 取值集合不变：仍允许 'prompt' | 'description'（见 normalizeSettings 的护栏）。 */
      writeField: 'description',
      /* 默认排序：weight（有 weight 的源）/ title */
      sort: 'weight',
      /* 每页条数 */
      pageSize: 60,
      /* 内容过滤 */
      filter: f,
      /* 源刷新：是否允许 api.github.com base64 兜底（会消耗 60/h 匿名配额） */
      allowGithubFallback: true,
      /* 可选的 api.github.com token（提高限流额度；仅存本地） */
      githubToken: '',
      /* 界面语言偏好（仅数据层透传，UI 决定） */
      locale: 'zh-Hans'
    };
  }

  /* 把任意来源的结构化成 defaultState 形状（导入 / 迁移共用） */
  function normalizeState(raw, opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    var src = raw.state && typeof raw.state === 'object' ? raw.state : raw; // 兼容导出包 {state:{...}}

    if (Array.isArray(src.favorites)) {
      var favs = [];
      for (var i = 0; i < src.favorites.length && favs.length < (LIMITS.FAVORITES_MAX || 5000); i++) {
        var it = migrateItem(src.favorites[i]);
        if (it) favs.push(it);
      }
      base.favorites = favs;
    }
    if (Array.isArray(src.customs)) {
      var cus = [];
      for (var c = 0; c < src.customs.length && cus.length < (LIMITS.CUSTOM_MAX_ITEMS || 5000); c++) {
        var cit = migrateItem(src.customs[c]);
        if (cit) { cit.custom = true; cus.push(cit); }
      }
      base.customs = cus;
    }
    if (Array.isArray(src.sources)) {
      var sos = [];
      for (var s = 0; s < src.sources.length; s++) {
        var so = normalizeSource(src.sources[s]);
        if (so) sos.push(so);
      }
      base.sources = sos;
    }
    if (Array.isArray(src.tags)) {
      var tgs = [];
      for (var t = 0; t < src.tags.length && tgs.length < (LIMITS.TAGS_MAX || 200); t++) {
        var tag = text.str(src.tags[t]).trim().slice(0, 40);
        if (tag !== '' && tgs.indexOf(tag) < 0) tgs.push(tag);
      }
      base.tags = tgs;
    }
    if (src.settings && typeof src.settings === 'object') {
      base.settings = normalizeSettings(src.settings);
    }
    if (typeof src.licenseAcknowledged === 'boolean') base.licenseAcknowledged = src.licenseAcknowledged;
    if (text.num(src.revision) !== null) base.revision = Math.max(0, Math.floor(text.num(src.revision)));
    if (Array.isArray(src.appliedMigrations)) {
      base.appliedMigrations = src.appliedMigrations.filter(function (x) { return typeof x === 'string'; });
    }
    if (text.num(src.schemaVersion) !== null) base.schemaVersion = Math.floor(text.num(src.schemaVersion));
    if (options.keepUpdatedAt !== true) base.updatedAt = text.nowIso();
    return base;
  }

  /* writeMode 的合法取值域（**只允许这两个**；见 defaultSettings 的说明） */
  var WRITE_MODES = ['insert', 'append'];

  function isWriteMode(v) {
    return typeof v === 'string' && WRITE_MODES.indexOf(v) >= 0;
  }

  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    /* 迁移护栏：非法/已废弃的 writeMode（含旧版写进去的 'replace'）一律静默回落默认值，
       不抛错、不保留脏值 —— 因为 'replace' 在本机没有实现路径（CONSTRAINTS-01 §C.1）。 */
    if (isWriteMode(raw.writeMode)) d.writeMode = raw.writeMode;
    if (raw.writeField === 'description' || raw.writeField === 'prompt') d.writeField = raw.writeField;
    if (raw.sort === 'weight' || raw.sort === 'title') d.sort = raw.sort;
    var ps = text.num(raw.pageSize);
    if (ps !== null) d.pageSize = text.clamp(ps, 10, 200);
    if (raw.filter && typeof raw.filter === 'object') {
      d.filter = filter.normalizeSettings ? filter.normalizeSettings(raw.filter) : d.filter;
    }
    if (typeof raw.allowGithubFallback === 'boolean') d.allowGithubFallback = raw.allowGithubFallback;
    if (typeof raw.githubToken === 'string') d.githubToken = raw.githubToken.slice(0, 200);
    if (typeof raw.locale === 'string' && raw.locale !== '') d.locale = raw.locale.slice(0, 20);
    return d;
  }

  /* 用户自定义源规范化（内置源不进 state.sources，只存“覆盖项”） */
  function normalizeSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = text.str(raw.id).trim();
    var url = text.str(raw.url).trim();
    if (id === '' || url === '') return null;
    var fieldMap = {};
    if (raw.fieldMap && typeof raw.fieldMap === 'object') {
      var keys = Object.keys(raw.fieldMap);
      for (var i = 0; i < keys.length; i++) fieldMap[keys[i]] = text.str(raw.fieldMap[keys[i]]);
    }
    return {
      id: id,
      name: text.str(raw.name) || id,
      kind: text.str(raw.kind) || 'custom-json',
      origin: 'custom',
      enabled: raw.enabled !== false,
      removable: true,
      lang: text.str(raw.lang) || 'zh',
      url: url,
      ref: raw.ref === undefined ? null : text.str(raw.ref),
      enabledFallback: raw.enabledFallback === true,
      homepage: text.str(raw.homepage),
      licenseId: text.str(raw.licenseId) || 'UNKNOWN',
      licenseNote: text.str(raw.licenseNote) || '用户自带源：许可由用户自行确认。',
      supportsWeight: raw.supportsWeight === true,
      fieldMap: fieldMap,
      listPath: text.str(raw.listPath),
      notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 10).map(function (n) { return text.str(n); }) : [],
      addedAt: text.str(raw.addedAt) || text.nowIso()
    };
  }

  /* ---------------------------------------------------------------------------
   * 3) 迁移
   * ------------------------------------------------------------------------ */
  var MIGRATIONS = [
    {
      to: 1,
      id: 'v0-to-v1',
      describe: '把无版本号的早期结构（favorites 为 uid 字符串数组、customs 为裸对象数组）升到 v1 完整快照。',
      run: function (raw) {
        var out = raw && typeof raw === 'object' ? raw : {};
        if (Array.isArray(out.favorites) && out.favorites.length > 0 && typeof out.favorites[0] === 'string') {
          out.favorites = out.favorites.map(function (uid) {
            return {
              uid: uid, id: uid, sourceId: 'legacy', title: String(uid), content: '',
              tags: [], lang: 'zh', custom: false
            };
          });
        }
        if (!out.settings) out.settings = {};
        if (!out.settings.filter) out.settings.filter = filter.defaultSettings ? filter.defaultSettings() : { enabled: true };
        return out;
      }
    }
  ];

  /**
   * 版本守卫：判断 raw.schemaVersion 相对当前版本的关系。
   * @returns {{ ok:boolean, from:number, to:number, migrations:Array, code:string|null, message:string|null }}
   */
  function planMigration(raw) {
    var from = raw && typeof raw === 'object' && text.num(raw.schemaVersion) !== null
      ? Math.floor(text.num(raw.schemaVersion))
      : 0; // v0 = 无版本号
    if (from > CURRENT_SCHEMA) {
      return {
        ok: false, from: from, to: CURRENT_SCHEMA, migrations: [],
        code: constants.ERROR_CODES.SCHEMA,
        message: '数据版本 v' + from + ' 高于本插件支持的 v' + CURRENT_SCHEMA
          + '（可能装过更新版本的插件）。为避免损坏数据，本次不写入持久层，已只读挂载。'
          + '如需继续使用，请在「源管理 / 高级」里显式重置，或换回更新版本的插件。'
      };
    }
    var steps = [];
    for (var i = 0; i < MIGRATIONS.length; i++) {
      if (MIGRATIONS[i].to > from && MIGRATIONS[i].to <= CURRENT_SCHEMA) steps.push(MIGRATIONS[i]);
    }
    steps.sort(function (a, b) { return a.to - b.to; });
    return { ok: true, from: from, to: CURRENT_SCHEMA, migrations: steps, code: null, message: null };
  }

  /* ---------------------------------------------------------------------------
   * 4) Store
   * ------------------------------------------------------------------------ */
  /**
   * 创建 store 实例。
   * @param {{ backend?:object, clock?:function, readOnly?:boolean }} [options]
   * @returns {object} store（见 docs/DATA-01-数据层接口.md §5）
   */
  function createStore(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var clock = text.isFn(opts.clock) ? opts.clock : function () { return new Date(); };
    var resolved = resolveBackend(opts.backend || null);
    var backend = resolved.backend;
    var report = resolved.report;

    var state = defaultState();
    var mode = opts.readOnly === true ? 'readonly' : 'rw';
    var lastError = null;
    var warnings = [];
    var loaded = false;

    function warn(msg) {
      if (warnings.indexOf(msg) < 0) warnings.push(msg);
    }

    /* 有界救援：从损坏状态里尽量捞出条目（绝不无声丢弃） */
    function rescue(raw) {
      var rescued = { favorites: 0, customs: 0, sources: 0, tags: 0, loose: [] };
      var out = defaultState();
      function tryItems(list, key) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
          var it = migrateItem(list[i]);
          if (it) { out[key].push(it); rescued[key]++; }
        }
      }
      tryItems(raw && raw.favorites, 'favorites');
      tryItems(raw && raw.customs, 'customs');
      if (raw && Array.isArray(raw.tags)) {
        for (var t = 0; t < raw.tags.length; t++) {
          var tag = text.str(raw.tags[t]).trim();
          if (tag !== '') { out.tags.push(tag.slice(0, 40)); rescued.tags++; }
        }
      }
      if (raw && Array.isArray(raw.sources)) {
        for (var s = 0; s < raw.sources.length; s++) {
          var so = normalizeSource(raw.sources[s]);
          if (so) { out.sources.push(so); rescued.sources++; }
        }
      }
      if (raw && raw.settings && typeof raw.settings === 'object') {
        try { out.settings = normalizeSettings(raw.settings); } catch (e) { /* 保留默认 */ }
      }
      return { state: out, rescued: rescued };
    }

    function persist(nextState) {
      nextState.appId = constants.APP_ID || nextState.appId;
      nextState.schemaVersion = CURRENT_SCHEMA;
      nextState.updatedAt = core.storage.nowIso(clock);
      nextState.revision = (text.num(nextState.revision) || 0) + 1;
      var payload = '';
      try {
        payload = JSON.stringify(nextState);
      } catch (e) {
        return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '状态无法序列化：' + ((e && e.message) || 'unknown') };
      }
      var bytes = text.utf8Bytes(payload);
      var maxBytes = LIMITS.STATE_MAX_BYTES || 2 * 1024 * 1024;
      if (bytes > maxBytes) {
        return {
          ok: false,
          code: constants.ERROR_CODES.QUOTA,
          message: '本地状态大小 ' + bytes + ' 字节，超过上限 ' + maxBytes + ' 字节。'
            + '请删除部分自建提示词或收藏后重试（数据未被写入，当前会话内的改动可能丢失）。',
          bytes: bytes
        };
      }
      try {
        var wrote = backend.setItem(STATE_KEY, payload);
        if (wrote === false) {
          return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '持久层拒绝了写入（无异常）' };
        }
      } catch (e2) {
        var isQuota = !!(e2 && (e2.name === 'QuotaExceededError' || e2.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e2.code === 22));
        return {
          ok: false,
          code: isQuota ? constants.ERROR_CODES.QUOTA : constants.ERROR_CODES.STORAGE,
          message: isQuota
            ? '本地存储配额已满（' + bytes + ' 字节写不进去）。可删除部分缓存或自建提示词后重试。'
            : '写入本地存储失败：' + ((e2 && e2.message) || 'unknown'),
          bytes: bytes
        };
      }
      state = nextState;
      return { ok: true, code: null, message: null, bytes: bytes, revision: state.revision };
    }

    /* 读盘 + 版本护栏 + 迁移 + 救援 */
    function load() {
      var raw = null;
      try { raw = backend.getItem(STATE_KEY); } catch (e) { raw = null; }
      if (raw === null || raw === undefined || raw === '') {
        state = defaultState();
        loaded = true;
        return { ok: true, created: true, migrated: false, code: null, message: null, reported: report };
      }
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok) {
        /* 损坏：留档 + 救援 */
        try { backend.setItem(QUARANTINE_KEY, String(raw).slice(0, 200000)); } catch (e2) { /* 留档失败不阻断 */ }
        warnings.push('本地状态 JSON 解析失败（' + parsed.error + '），已把原始串留档在 ' + QUARANTINE_KEY + '，本次以默认值启动。');
        state = defaultState();
        mode = 'readonly';
        lastError = { code: constants.ERROR_CODES.SCHEMA, message: warnings[warnings.length - 1] };
        loaded = true;
        return { ok: false, created: false, migrated: false, code: lastError.code, message: lastError.message, reported: report };
      }

      var plan = planMigration(parsed.value);
      if (!plan.ok) {
        /* 未来版本：只读挂载，绝不覆盖 */
        try { backend.setItem(QUARANTINE_KEY, String(raw).slice(0, 200000)); } catch (e3) { /* 忽略 */ }
        state = normalizeState(parsed.value, { keepUpdatedAt: true });
        mode = 'readonly';
        lastError = { code: plan.code, message: plan.message };
        warnings.push(plan.message);
        loaded = true;
        return { ok: false, created: false, migrated: false, code: plan.code, message: plan.message, reported: report };
      }

      var working = parsed.value;
      var applied = [];
      for (var i = 0; i < plan.migrations.length; i++) {
        var step = plan.migrations[i];
        try {
          working = step.run(working);
          applied.push(step.id);
        } catch (e4) {
          warnings.push('迁移 ' + step.id + ' 失败（' + ((e4 && e4.message) || 'unknown') + '），已改用救援模式读取。');
          break;
        }
      }

      var normalized = null;
      try {
        normalized = normalizeState(working, { keepUpdatedAt: true });
      } catch (e5) {
        var r = rescue(working);
        normalized = r.state;
        warnings.push('状态规范化失败，已救援出 ' + r.rescued.favorites + ' 条收藏 / ' + r.rescued.customs + ' 条自建。');
      }
      for (var a = 0; a < applied.length; a++) {
        if (normalized.appliedMigrations.indexOf(applied[a]) < 0) normalized.appliedMigrations.push(applied[a]);
      }
      state = normalized;
      loaded = true;

      var result = { ok: true, created: false, migrated: applied.length > 0, appliedMigrations: applied, code: null, message: null, reported: report };
      if (applied.length > 0 || !report.durable) {
        /* 迁移/降级后立刻回写一次，把新结构固化（只读模式下跳过） */
        if (mode === 'rw') {
          var w = persist(state);
          if (!w.ok) {
            warnings.push('迁移后回写失败：' + w.message);
            result.ok = false;
            result.code = w.code;
            result.message = w.message;
          }
        }
      }
      return result;
    }

    function snapshot() {
      return text.cloneJSON(state) || defaultState();
    }

    function update(mutator) {
      if (!loaded) load();
      if (mode === 'readonly') {
        return {
          ok: false,
          code: (lastError && lastError.code) || constants.ERROR_CODES.SCHEMA,
          message: (lastError && lastError.message) || '持久层处于只读模式，拒绝写入。',
          readOnly: true
        };
      }
      var draft = snapshot();
      var mutated = draft;
      try {
        if (text.isFn(mutator)) {
          var maybe = mutator(draft);
          if (maybe && typeof maybe === 'object') mutated = maybe;
        }
      } catch (e) {
        return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '更新回调抛错：' + ((e && e.message) || 'unknown') };
      }
      var normalized = normalizeState(mutated, { keepUpdatedAt: false });
      normalized.revision = text.num(draft.revision) || 0;
      normalized.appliedMigrations = Array.isArray(draft.appliedMigrations) ? draft.appliedMigrations.slice(0) : [];
      normalized.licenseAcknowledged = mutated.licenseAcknowledged === true;
      var res = persist(normalized);
      if (!res.ok) {
        warnings.push('写入失败：' + res.message);
        lastError = { code: res.code, message: res.message };
      }
      return res;
    }

    function reset(reason) {
      warnings = [];
      lastError = null;
      mode = 'rw';
      var fresh = defaultState();
      var res = persist(fresh);
      if (res.ok && reason) {
        warnings.push('状态已按用户要求重置：' + text.str(reason));
      }
      return res;
    }

    /* --------------------------- 子对象：缓存（独立键、可单独淘汰） ------- */
    function cacheKey(sourceId) {
      return CACHE_PREFIX + text.str(sourceId);
    }

    function cacheGet(sourceId) {
      var key = cacheKey(sourceId);
      var raw = null;
      try { raw = backend.getItem(key); } catch (e) { return null; }
      if (!raw) return null;
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
        try { backend.removeItem(key); } catch (e2) { /* 忽略 */ }
        return null;
      }
      var entry = parsed.value;
      if (text.num(entry.schemaVersion) !== CURRENT_SCHEMA) return null; // 版本不符 → 当未命中
      return entry;
    }

    function cacheList() {
      var keys = [];
      try {
        if (text.isFn(backend.keys)) keys = backend.keys();
      } catch (e) { keys = []; }
      var out = [];
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(CACHE_PREFIX) !== 0) continue;
        var entry = cacheGet(keys[i].slice(CACHE_PREFIX.length));
        if (entry) out.push(entry);
      }
      return out;
    }

    function cacheEnforceTotal(sourceIdJustWritten) {
      var totalMax = LIMITS.CACHE_MAX_BYTES_TOTAL || 2 * 1024 * 1024;
      var entries = cacheList();
      var total = 0;
      for (var i = 0; i < entries.length; i++) total += text.num(entries[i].bytes) || 0;
      if (total <= totalMax) return { ok: true, evicted: [] };
      entries.sort(function (a, b) {
        var ta = text.str(a.fetchedAt); var tb = text.str(b.fetchedAt);
        if (ta === tb) return 0;
        return ta < tb ? -1 : 1; // 最旧在前
      });
      var evicted = [];
      for (var j = 0; j < entries.length && total > totalMax; j++) {
        if (entries[j].sourceId === sourceIdJustWritten) continue; // 刚写的最后淘汰
        total -= text.num(entries[j].bytes) || 0;
        try { backend.removeItem(cacheKey(entries[j].sourceId)); } catch (e) { /* 忽略 */ }
        evicted.push(entries[j].sourceId);
      }
      return { ok: true, evicted: evicted };
    }

    /**
     * 写缓存（带逐源字节上限 + 合计上限淘汰）。
     * @param {string} sourceId
     * @param {Array<object>} items 归一化条目（**过滤前**的完整集）
     * @param {object} meta { url, ref, fetchedAt, license }
     */
    function cacheSet(sourceId, items, meta) {
      var m = meta && typeof meta === 'object' ? meta : {};
      var list = Array.isArray(items) ? items : [];
      var maxBytes = LIMITS.CACHE_MAX_BYTES_PER_SOURCE || 900 * 1024;
      var kept = list.slice(0);
      var payload = '';
      var bytes = 0;
      var truncated = false;
      for (var attempt = 0; attempt < 40; attempt++) {
        var entry = {
          schemaVersion: CURRENT_SCHEMA,
          appId: constants.APP_ID || 'dsh-prompt-market',
          sourceId: text.str(sourceId),
          url: text.str(m.url),
          ref: m.ref === undefined || m.ref === null ? null : text.str(m.ref),
          fetchedAt: text.str(m.fetchedAt) || core.storage.nowIso(clock),
          itemCount: list.length,
          storedCount: kept.length,
          truncated: truncated,
          license: m.license || null,
          items: kept
        };
        var body = '';
        try { body = JSON.stringify(entry); } catch (e) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '缓存序列化失败' }; }
        bytes = text.utf8Bytes(body);
        entry.bytes = bytes;
        try { payload = JSON.stringify(entry); } catch (e2) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '缓存序列化失败' }; }
        bytes = text.utf8Bytes(payload);
        if (bytes <= maxBytes || kept.length <= 1) break;
        /* 超限：把尾部条目砍掉（保留顺序靠前的条目，与 UI 默认排序一致） */
        var newLen = Math.max(1, Math.floor(kept.length * 0.7));
        kept = kept.slice(0, newLen);
        truncated = true;
      }
      var written = { ok: true, code: null, message: null, bytes: bytes, storedCount: kept.length, truncated: truncated };
      try {
        backend.setItem(cacheKey(sourceId), payload);
      } catch (e3) {
        var isQuota = !!(e3 && (e3.name === 'QuotaExceededError' || e3.code === 22));
        /* 配额满：先淘汰其它源再重试一次；仍失败就放弃缓存（不影响本次会话可用性） */
        cacheEnforceTotal(sourceId);
        try {
          backend.setItem(cacheKey(sourceId), payload);
        } catch (e4) {
          warnings.push('缓存写入失败（' + (isQuota ? '配额已满' : '存储错误') + '），本次仍可正常浏览，但离线降级数据未更新。');
          return { ok: false, code: isQuota ? constants.ERROR_CODES.QUOTA : constants.ERROR_CODES.STORAGE, message: warnings[warnings.length - 1], bytes: bytes };
        }
      }
      var evict = cacheEnforceTotal(sourceId);
      if (evict.evicted.length > 0) written.evicted = evict.evicted;
      if (truncated) written.message = '条目数超出单源缓存上限，已截断为 ' + kept.length + '/' + list.length + ' 条（仅影响离线降级数据量）。';
      return written;
    }

    function cacheRemove(sourceId) {
      try { backend.removeItem(cacheKey(sourceId)); return { ok: true }; } catch (e) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '删除缓存失败' }; }
    }

    function cacheClear() {
      var entries = cacheList();
      var failed = [];
      for (var i = 0; i < entries.length; i++) {
        var r = cacheRemove(entries[i].sourceId);
        if (!r.ok) failed.push(entries[i].sourceId);
      }
      return { ok: failed.length === 0, removed: entries.length - failed.length, failed: failed };
    }

    function cacheStats() {
      var entries = cacheList();
      var bytes = 0;
      var list = [];
      for (var i = 0; i < entries.length; i++) {
        bytes += text.num(entries[i].bytes) || 0;
        list.push({
          sourceId: entries[i].sourceId,
          url: entries[i].url,
          fetchedAt: entries[i].fetchedAt,
          itemCount: entries[i].itemCount,
          storedCount: entries[i].storedCount,
          truncated: entries[i].truncated === true,
          bytes: text.num(entries[i].bytes) || 0
        });
      }
      return {
        entries: list,
        totalBytes: bytes,
        limitBytes: LIMITS.CACHE_MAX_BYTES_TOTAL || 2 * 1024 * 1024,
        backend: report.kind
      };
    }

    /* --------------------------- 状态读接口（只读视图） ----------------- */
    function toJSON() {
      return snapshot();
    }

    function status() {
      return {
        loaded: loaded,
        readOnly: mode === 'readonly',
        backend: report.kind,
        durable: report.durable,
        backendSource: report.source,
        schemaVersion: state.schemaVersion,
        currentSchemaVersion: CURRENT_SCHEMA,
        revision: state.revision,
        updatedAt: state.updatedAt,
        appliedMigrations: state.appliedMigrations.slice(0),
        warnings: warnings.slice(0),
        lastError: lastError ? { code: lastError.code, message: lastError.message } : null,
        counts: {
          favorites: state.favorites.length,
          customs: state.customs.length,
          sources: state.sources.length,
          tags: state.tags.length
        }
      };
    }

    return {
      /* 底层 */
      backend: backend,
      backendReport: report,
      load: load,
      status: status,
      snapshot: snapshot,
      toJSON: toJSON,
      update: update,
      reset: reset,
      /* 缓存子存储 */
      cacheGet: cacheGet,
      cacheSet: cacheSet,
      cacheRemove: cacheRemove,
      cacheClear: cacheClear,
      cacheList: cacheList,
      cacheStats: cacheStats,
      cacheKey: cacheKey
    };
  }

  /**
   * 导入护栏：把任意 JSON 文本/对象解析成可写入的状态。
   * @param {string|object} input
   * @returns {{ ok:boolean, code:string|null, message:string|null, state:object|null,
   *             stats:object|null, requiresReset:boolean }}
   */
  function parseImport(input) {
    var raw = input;
    if (typeof raw === 'string') {
      if (text.utf8Bytes(raw) > (LIMITS.IMPORT_MAX_BYTES || 5 * 1024 * 1024)) {
        return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容超过上限 ' + (LIMITS.IMPORT_MAX_BYTES || 0) + ' 字节，已拒绝解析。', state: null, stats: null, requiresReset: false };
      }
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok) {
        return { ok: false, code: constants.ERROR_CODES.PARSE, message: '导入内容不是合法 JSON：' + parsed.error, state: null, stats: null, requiresReset: false };
      }
      raw = parsed.value;
    }
    if (!raw || typeof raw !== 'object') {
      return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容必须是对象或数组。', state: null, stats: null, requiresReset: false };
    }
    if (text.hasDangerousKey(raw)) {
      return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容含 __proto__/constructor/prototype 键，出于安全考虑已拒绝。', state: null, stats: null, requiresReset: false };
    }
    var safe = text.stripDangerousKeys(raw);

    /* 支持三种形态：本插件导出包 / 裸 state / 裸条目数组 */
    var container = safe;
    if (Array.isArray(safe)) {
      container = { favorites: safe };
    } else if (safe.appId !== undefined && safe.appId !== (constants.APP_ID || 'dsh-prompt-market') && safe.state === undefined) {
      return {
        ok: false, code: constants.ERROR_CODES.BAD_INPUT,
        message: '导入包声明 appId=' + text.str(safe.appId) + '，不属于本插件（期望 ' + (constants.APP_ID || '') + '）。',
        state: null, stats: null, requiresReset: false
      };
    }

    var version = text.num(container.schemaVersion);
    var requiresReset = false;
    if (version !== null && version > CURRENT_SCHEMA) {
      requiresReset = true;
      return {
        ok: false,
        code: constants.ERROR_CODES.SCHEMA,
        message: '导入包的 schemaVersion=' + version + ' 高于本插件支持的 ' + CURRENT_SCHEMA + '，'
          + '为避免写坏数据已拒绝导入。请升级插件，或确认后用「重置」清空后再导入旧格式。',
        state: null,
        stats: null,
        requiresReset: requiresReset
      };
    }

    var normalized = normalizeState(container, { keepUpdatedAt: false });
    var stats = {
      schemaVersion: normalized.schemaVersion,
      favorites: normalized.favorites.length,
      customs: normalized.customs.length,
      tags: normalized.tags.length,
      sources: normalized.sources.length,
      incomingVersion: version
    };
    return { ok: true, code: null, message: null, state: normalized, stats: stats, requiresReset: false };
  }

  /**
   * 导出：得到可写文件的导出包对象（调用方决定文件名与下载方式）。
   * @param {object} store
   * @param {object} [options] { includeCache:boolean }
   */
  function buildExport(store, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var state = store.toJSON();
    var payload = {
      appId: constants.APP_ID || 'dsh-prompt-market',
      kind: 'dsh-prompt-market-export',
      schemaVersion: CURRENT_SCHEMA,
      exportedAt: core.storage.nowIso(),
      plugin: { name: 'dsh-prompt-market', dataApiMajor: constants.DATA_API_MAJOR || 1 },
      state: {
        favorites: state.favorites,
        customs: state.customs,
        sources: state.sources,
        tags: state.tags,
        settings: state.settings,
        licenseAcknowledged: state.licenseAcknowledged === true,
        appliedMigrations: state.appliedMigrations
      },
      counts: {
        favorites: state.favorites.length,
        customs: state.customs.length,
        tags: state.tags.length,
        sources: state.sources.length
      }
    };
    if (opts.includeCache === true) {
      payload.cache = store.cacheList();
    }
    payload.checksum = text.fnv1a32(JSON.stringify(payload.state));
    return { ok: true, code: null, message: null, payload: payload, fileName: 'prompt-market-backup-' + slug(text.nowIso()) + '.json' };
  }

  function slug(iso) {
    return text.str(iso).replace(/[:.]/g, '-');
  }

  core.storage = {
    STATE_KEY: STATE_KEY,
    CACHE_PREFIX: CACHE_PREFIX,
    QUARANTINE_KEY: QUARANTINE_KEY,
    CURRENT_SCHEMA: CURRENT_SCHEMA,
    MIGRATIONS: MIGRATIONS,
    /* writeMode 合法取值域：只含 'insert' / 'append'（无 'replace'） */
    WRITE_MODES: WRITE_MODES,
    isWriteMode: isWriteMode,
    nowIso: function (clock) { return text.nowIso(clock); },
    createStore: createStore,
    memoryBackend: memoryBackend,
    resolveBackend: resolveBackend,
    probeBackend: probeBackend,
    defaultState: defaultState,
    defaultSettings: defaultSettings,
    normalizeState: normalizeState,
    normalizeSettings: normalizeSettings,
    normalizeSource: normalizeSource,
    migrateItem: migrateItem,
    planMigration: planMigration,
    parseImport: parseImport,
    buildExport: buildExport
  };
})(__pmCore);
