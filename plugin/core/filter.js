/* =============================================================================
 * plugin/core/filter.js — 可配置内容过滤（默认开启）
 * =============================================================================
 * 硬需求来源：CONSTRAINTS-01 §B2 强制义务 ③、REL-01 §2.5、任务书 (8)。
 *   - 中文库实测含 DAN 越狱（id:110「AI DAN（旧版/失效）」）与成人角色扮演
 *     （「涩涩女友」「好耶！魅魔！」）条目；
 *   - 过滤**默认开启**，但必须可配置（开关、动作模式、自定义词、单条规则启停）。
 *
 * 语义约定（**重要，UI 与 verifier 需按此断言**）：
 *   - 过滤发生在**读取时**（query/list），不发生在缓存写入时。这样用户关掉过滤
 *     就立刻能看到全部条目，且缓存里不留“已被裁剪”的假数据。
 *   - actionMode='hide'：命中的条目不出现在结果里；
 *   - actionMode='mark'：命中的条目保留，但被标记 filtered:true + filterMatches，
 *     由 UI 决定是否折叠（便于用户自查过滤是否过激）。
 *   - 规则匹配的字段：title / description / remark / content / tags。
 *   - 全程不抛异常；任何规则异常都降级为“不匹配”。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};

  var FILTER_FIELDS = ['title', 'description', 'remark', 'content', 'tags'];

  function cloneRules() {
    var src = constants.FILTER_DEFAULT_RULES || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var r = src[i];
      out.push({
        id: r.id,
        label: r.label,
        enabled: r.enabled !== false,
        severity: r.severity || 'medium',
        custom: r.custom === true,
        patterns: (r.patterns || []).slice(0)
      });
    }
    return out;
  }

  /**
   * 合并默认规则与用户设置，返回**生效的规则表**（不编译正则）。
   * @param {object} [settings] 过滤器设置（shape 见 constants.FILTER_DEFAULT_SETTINGS）
   * @returns {Array<{id,label,enabled,severity,custom,patterns}>}
   */
  function rules(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var out = cloneRules();
    var disabledIds = Array.isArray(s.disabledRuleIds) ? s.disabledRuleIds : [];
    var extraIds = Array.isArray(s.extraRuleIds) ? s.extraRuleIds : [];
    var customTerms = Array.isArray(s.customTerms) ? s.customTerms : [];

    var i;
    for (i = 0; i < out.length; i++) {
      if (disabledIds.indexOf(out[i].id) >= 0) out[i].enabled = false;
      if (extraIds.indexOf(out[i].id) >= 0) out[i].enabled = true;
      if (out[i].custom) {
        /* 自定义屏蔽词：逐词作为子串规则（不编译成正则，避免用户输入的元字符） */
        out[i].patterns = [];
        out[i].terms = [];
        for (var t = 0; t < customTerms.length; t++) {
          var term = text.str(customTerms[t]).trim();
          if (term !== '') out[i].terms.push(term);
        }
        if (out[i].terms.length === 0) out[i].enabled = false;
      }
    }
    return out;
  }

  /* 单条 pattern 编译成正则；失败则降级为字面量 includes（永不抛错） */
  function compilePattern(pattern) {
    var src = text.str(pattern);
    if (src === '') return null;
    try {
      var flags = 'i';
      if (!/^\^[\s\S]*\$/.test(src)) flags += 'g';
      return { kind: 'regex', value: new RegExp(src, flags), raw: src };
    } catch (e) {
      return { kind: 'literal', value: src.toLowerCase(), raw: src };
    }
  }

  /**
   * 编译生效规则（UI 可缓存；设置变化时重建）。
   * @param {object} [settings]
   * @returns {{ rules:Array, compiled:Array, enabled:boolean, actionMode:string }}
   */
  function compile(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var enabled = s.enabled !== false; // 默认 true
    var actionMode = s.actionMode === 'mark' ? 'mark' : 'hide';
    var list = rules(s);
    var compiled = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r.enabled) continue;
      var entry = {
        id: r.id,
        label: r.label,
        severity: r.severity,
        custom: r.custom,
        patterns: [],
        terms: r.terms || []
      };
      for (var p = 0; p < r.patterns.length; p++) {
        var c = compilePattern(r.patterns[p]);
        if (c) entry.patterns.push(c);
      }
      compiled.push(entry);
    }
    return { rules: list, compiled: compiled, enabled: enabled, actionMode: actionMode };
  }

  /* 对单个字符串跑一条已编译规则，返回命中证据（无命中返回 null） */
  function matchOneRule(rule, haystack) {
    var i;
    for (i = 0; i < rule.terms.length; i++) {
      var idx = haystack.toLowerCase().indexOf(rule.terms[i].toLowerCase());
      if (idx >= 0) return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: rule.terms[i] };
    }
    for (i = 0; i < rule.patterns.length; i++) {
      var p = rule.patterns[i];
      if (p.kind === 'literal') {
        if (haystack.toLowerCase().indexOf(p.value) >= 0) {
          return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: p.raw };
        }
      } else {
        try {
          p.value.lastIndex = 0;
          var m = p.value.exec(haystack);
          if (m) {
            return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: m[0] };
          }
        } catch (e) { /* 单条正则异常不影响其它规则 */ }
      }
    }
    return null;
  }

  /**
   * 对一段文本做过滤检查。
   * @param {string} s 待检文本
   * @param {object} [settings] 或已编译结果（compile() 的返回值）
   * @returns {{ blocked:boolean, matches:Array<{ruleId,label,severity,hit}>, actionMode:string }}
   */
  function check(s, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var result = { blocked: false, matches: [], actionMode: compiledSet.actionMode };
    if (!compiledSet.enabled) return result;

    var haystack = text.str(s);
    if (haystack === '') return result;

    for (var i = 0; i < compiledSet.compiled.length; i++) {
      var hit = matchOneRule(compiledSet.compiled[i], haystack);
      if (hit) result.matches.push(hit);
    }
    result.blocked = result.matches.length > 0;
    return result;
  }

  /**
   * 对一个归一化条目做过滤（扫 title/description/remark/content/tags）。
   * @param {object} item 归一化模型
   * @param {object} [settings]
   * @returns {{ blocked:boolean, matches:Array, fields:Array<string> }}
   */
  function checkItem(item, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var out = { blocked: false, matches: [], fields: [] };
    if (!compiledSet.enabled || !item || typeof item !== 'object') return out;

    for (var f = 0; f < FILTER_FIELDS.length; f++) {
      var field = FILTER_FIELDS[f];
      var raw = item[field];
      var s = Array.isArray(raw) ? raw.join(' , ') : text.str(raw);
      if (s === '') continue;
      for (var i = 0; i < compiledSet.compiled.length; i++) {
        var hit = matchOneRule(compiledSet.compiled[i], s);
        if (hit) {
          /* 同一规则在同一字段只记一次 */
          var dup = false;
          for (var d = 0; d < out.matches.length; d++) {
            if (out.matches[d].ruleId === hit.ruleId && out.matches[d].field === field) { dup = true; break; }
          }
          if (!dup) {
            out.matches.push({ ruleId: hit.ruleId, label: hit.label, severity: hit.severity, hit: hit.hit, field: field });
            if (out.fields.indexOf(field) < 0) out.fields.push(field);
          }
        }
      }
    }
    out.blocked = out.matches.length > 0;
    return out;
  }

  /**
   * 对列表批量过滤。**这是 UI 唯一的入口**。
   * @param {Array<object>} items
   * @param {object} [settings]
   * @returns {{ items:Array<object>, kept:Array<object>, dropped:Array<object>, flagged:Array<object>,
   *             stats:{ input:number, kept:number, dropped:number, flagged:number, filtered:boolean, actionMode:string } }}
   *          hide 模式：items = kept（不含命中项）；mark 模式：items 含命中项但带 filtered 标记。
   */
  function apply(items, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var list = Array.isArray(items) ? items : [];
    var kept = [];
    var dropped = [];
    var flagged = [];
    var resultItems = [];

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var res = checkItem(item, compiledSet);
      if (!res.blocked) {
        kept.push(item);
        resultItems.push(item);
        continue;
      }
      var annotated = item;
      if (compiledSet.enabled) {
        annotated = {};
        for (var k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k)) annotated[k] = item[k];
        }
        annotated.filtered = true;
        annotated.filterMatches = res.matches;
      }
      if (compiledSet.enabled && compiledSet.actionMode === 'mark') {
        flagged.push(annotated);
        kept.push(annotated);
        resultItems.push(annotated);
      } else {
        dropped.push(annotated);
      }
    }

    return {
      items: resultItems,
      kept: kept,
      dropped: dropped,
      flagged: flagged,
      stats: {
        input: list.length,
        kept: kept.length,
        dropped: dropped.length,
        flagged: flagged.length,
        filtered: compiledSet.enabled,
        actionMode: compiledSet.actionMode
      }
    };
  }

  /* 默认设置（返回新对象，可直接写进 store） */
  function defaultSettings() {
    var d = constants.FILTER_DEFAULT_SETTINGS || {};
    return {
      enabled: d.enabled !== false,
      actionMode: d.actionMode === 'mark' ? 'mark' : 'hide',
      customTerms: (d.customTerms || []).slice(0),
      extraRuleIds: (d.extraRuleIds || []).slice(0),
      disabledRuleIds: (d.disabledRuleIds || []).slice(0)
    };
  }

  /* 规范化用户传入的设置（导入 / UI 写入都走这里） */
  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    if (typeof raw.enabled === 'boolean') d.enabled = raw.enabled;
    if (raw.actionMode === 'mark' || raw.actionMode === 'hide') d.actionMode = raw.actionMode;
    if (Array.isArray(raw.customTerms)) {
      var terms = [];
      for (var i = 0; i < raw.customTerms.length && terms.length < 200; i++) {
        var t = text.str(raw.customTerms[i]).trim();
        if (t !== '' && terms.indexOf(t) < 0) terms.push(t.slice(0, 64));
      }
      d.customTerms = terms;
    }
    if (Array.isArray(raw.extraRuleIds)) d.extraRuleIds = raw.extraRuleIds.filter(function (x) { return typeof x === 'string'; });
    if (Array.isArray(raw.disabledRuleIds)) d.disabledRuleIds = raw.disabledRuleIds.filter(function (x) { return typeof x === 'string'; });
    return d;
  }

  /* 命中统计（不裁剪；给“过滤掉了 N 条”的 UI 提示用） */
  function countBlocked(items, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var n = 0;
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && checkItem(list[i], compiledSet).blocked) n++;
    }
    return n;
  }

  core.filter = {
    FILTER_FIELDS: FILTER_FIELDS,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    rules: rules,
    compile: compile,
    check: check,
    checkItem: checkItem,
    apply: apply,
    countBlocked: countBlocked
  };
})(__pmCore);
