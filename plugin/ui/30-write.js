/* ==== unit: ui-write ==== */
/* 提示词市场 · UI 单元 30 —— 写入通道（面板自有 helper）。
 *
 * 队长裁决 F-8 / F-9（必须逐条遵守）：
 *   - 产品写入**只用本文件的 helper**：主通道 `insertText(text, captureInsertion())`，
 *     当场捕获、当场插入，中间**不得有 await**；**不依赖** t2 的诊断模块
 *     （其默认顺序是覆盖式动词优先，会丢掉 req-9 的 Ctrl+Z 可撤销），也**不调用**它导出的写函数；
 *   - 界面上**没有** append 语义的入口（F-9 裁决：该动作已取消）：绝不把**整段草稿 payload**
 *     交给插入式语义（那会把整段草稿复制进插入点，属数据损坏级）；只插入该插入的那一段文本；
 *   - `setDraft` 只作**后备**，且仅在读回证明确实没写进去时才降级（闸门同 t2 attempt 2）。
 *
 * 本单元内所有写入动作都输出**指纹字段**（只给长度与哈希，绝不给内容）：
 *   beforeLength / afterLength / beforeHash / afterHash / replaced / verified / insertTextReturned。
 */
(function (ns) {
  'use strict';

  var W = ns.write = ns.write || {};

  W.MSG_INSERTED = '已写入（可 Ctrl+Z 撤销）';
  W.MSG_UNCONFIRMED = '未确认：写入未被读回证实';
  /* 弱判据专用文案：未捕获到选区，只能按「草稿确实变了」判定（评审 F-5） */
  W.MSG_INSERTED_WEAK = '已写入草稿（未捕获到选区，按草稿变化判定）';
  W.MSG_REPLACE_NEEDS_CTRL_A = '无法替换：请先按 Ctrl+A 全选草稿（插件无法主动清空草稿或设置选区；全选后插入即等价于覆盖整段草稿）';
  W.MSG_NO_ACTIONS = '本会话未注入 inputActions：写入按钮暂不可用。';
  W.MSG_CAPTURE_FAILED = '无法捕获草稿选区（captureInsertion 失败），已放弃本次写入。';

  /* 覆盖率白名单（verifier 强制）：只接受这些键名组合，白名单之外一律 unknown，绝不猜 */
  W.RANGE_PAIRS = [['from', 'to'], ['start', 'end'], ['anchor', 'head']];
  W.RANGE_NESTED = ['selection', 'range'];
  /* 显式排除：revision 是**确证存在**的数值字段，但它**不是偏移量**（asar:417010 `...this.caretSpan(), revision`）。
     任何「找两个数值字段」的泛化都会把它当端点 ⇒ 轻则误拒，重则误判全选并真的执行部分替换。 */
  W.EXCLUDED_KEYS = ['revision'];
  W.REVISION_KEYS = ['revision', 'rev', 'version', 'revisionId', 'timestamp', 'time'];

  /* 只探测，不写入 */
  W.inspect = function (actions) {
    var out = { has: false, setDraft: false, insertText: false, captureInsertion: false, ok: false, keys: [] };
    if (!actions || typeof actions !== 'object') return out;
    out.has = true;
    out.setDraft = typeof actions.setDraft === 'function';
    out.insertText = typeof actions.insertText === 'function';
    out.captureInsertion = typeof actions.captureInsertion === 'function';
    out.ok = out.insertText && out.captureInsertion;
    try { out.keys = Object.keys(actions).sort(); } catch (e) { out.keys = ['<threw>']; }
    return out;
  };

  /* 草稿读取：由组件传入 getDraft()（Returns 最新草稿字符串或 undefined） */
  W.readDraft = function (getDraft) {
    if (typeof getDraft !== 'function') return undefined;
    try {
      var v = getDraft();
      return typeof v === 'string' ? v : undefined;
    } catch (e) { return undefined; }
  };

  W.captureSpan = function (actions) {
    if (!actions || typeof actions.captureInsertion !== 'function') return { ok: false, error: 'captureInsertion 不存在' };
    try { return { ok: true, span: actions.captureInsertion() }; } catch (e) { return { ok: false, error: ns.errText(e) }; }
  };

  /* 逐字段安全转换（隐私：字符串只给长度；失败不丢报告） */
  W.describeSpan = function (span, captureError) {
    var out = { kind: typeof span, keys: [], revisionType: null, revisionText: null, fields: [], captureError: captureError || null };
    if (span === null || typeof span !== 'object') return out;
    var keys = [];
    try { keys = Object.keys(span).sort(); } catch (e) { keys = []; }
    out.keys = keys;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v;
      try { v = span[k]; } catch (e2) { out.fields.push({ k: k, t: 'unconvertible' }); continue; }
      var t = typeof v;
      if (t === 'number' || t === 'boolean') {
        out.fields.push({ k: k, t: t, n: v });
        if (W.REVISION_KEYS.indexOf(k) >= 0 && out.revisionType === null) {
          out.revisionType = t;
          try { out.revisionText = String(v); } catch (e3) { out.revisionText = '<unconvertible>'; }
        }
      } else if (t === 'string') {
        out.fields.push({ k: k, t: 'string', len: v.length });
      } else if (v === null) {
        out.fields.push({ k: k, t: 'null' });
      } else {
        out.fields.push({ k: k, t: 'unserializable:' + t });
      }
    }
    return out;
  };

  /* 白名单提取选区范围：只在 span 自身（或白名单嵌套键内）按**白名单键名**取偏移；
     anchor/head 为无序对 ⇒ 先取 min/max；解不出/缺端点 ⇒ null（不猜）。 */
  W.extractRange = function (span) {
    if (span === null || typeof span !== 'object') return null;
    var i, j, a, b;
    for (i = 0; i < W.RANGE_PAIRS.length; i++) {
      a = span[W.RANGE_PAIRS[i][0]];
      b = span[W.RANGE_PAIRS[i][1]];
      if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b)) {
        return { from: Math.min(a, b), to: Math.max(a, b), endpointKeys: [W.RANGE_PAIRS[i][0], W.RANGE_PAIRS[i][1]] };
      }
    }
    for (j = 0; j < W.RANGE_NESTED.length; j++) {
      var nested = span[W.RANGE_NESTED[j]];
      if (nested === null || typeof nested !== 'object') continue;
      for (i = 0; i < W.RANGE_PAIRS.length; i++) {
        a = nested[W.RANGE_PAIRS[i][0]];
        b = nested[W.RANGE_PAIRS[i][1]];
        if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b)) {
          return {
            from: Math.min(a, b),
            to: Math.max(a, b),
            endpointKeys: [W.RANGE_NESTED[j] + '.' + W.RANGE_PAIRS[i][0], W.RANGE_NESTED[j] + '.' + W.RANGE_PAIRS[i][1]]
          };
        }
      }
    }
    return null;
  };

  /* 覆盖率判定：严格 `min===0 && max===draftLength`；缺端点/解不出 ⇒ 'unknown' */
  W.coverage = function (span, draftLength, captureError) {
    var len = ns.num(draftLength);
    var basis = { endpointKeysUsed: null, normalizedRange: null, draftLength: len, excludedKeys: W.EXCLUDED_KEYS.slice(0), whitelistMiss: [], revisionPresent: false };
    if (span !== null && typeof span === 'object') {
      try {
        basis.revisionPresent = Object.prototype.hasOwnProperty.call(span, 'revision');
        var keys = Object.keys(span);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (W.EXCLUDED_KEYS.indexOf(k) >= 0) continue;
          if (W.REVISION_KEYS.indexOf(k) >= 0) continue;
          var known = false;
          for (var p = 0; p < W.RANGE_PAIRS.length; p++) {
            if (W.RANGE_PAIRS[p][0] === k || W.RANGE_PAIRS[p][1] === k) known = true;
          }
          if (W.RANGE_NESTED.indexOf(k) >= 0) known = true;
          if (!known) basis.whitelistMiss.push(k);
        }
      } catch (e) { /* 保守：继续判定 */ }
    }
    var r = W.extractRange(span);
    if (!r || len === null) {
      return { coversAll: 'unknown', basis: basis, reason: captureError || '无法从捕获对象解出选区范围（白名单外形状，不猜）' };
    }
    basis.endpointKeysUsed = r.endpointKeys;
    basis.normalizedRange = { min: r.from, max: r.to };
    var covers = (r.from === 0 && r.to === len);
    return { coversAll: covers, basis: basis, reason: null };
  };

  /* 插入后的期望草稿（仅当能解出范围时可精确计算；否则 null ⇒ 用「哈希变化」作弱判据） */
  W.expectedAfterInsert = function (draft, range, text) {
    if (typeof draft !== 'string' || !range) return null;
    if (range.from < 0 || range.to > draft.length) return null;
    return draft.slice(0, range.from) + ns.str(text) + draft.slice(range.to);
  };

  function baseReport(action, before) {
    return {
      action: action,
      method: null,
      replaced: false,
      verified: false,
      insertTextReturned: null,
      beforeLength: before.length,
      afterLength: before.length,
      beforeHash: before.hash,
      afterHash: before.hash,
      coversAll: 'unknown',
      coversAllBasis: null,
      endpointKeysUsed: null,
      excludedKeys: W.EXCLUDED_KEYS.slice(0),
      whitelistMiss: [],
      revisionPresent: false,
      draftLengthAtCapture: before.length,
      noAwaitBetween: true,
      reason: null,
      rejectedAt: null
    };
  }

  /**
   * 插入（面板唯一的主写入动作）。
   * `text` 必须是**要插入的那一小段**，绝不是整段草稿（F-9）。
   */
  W.insert = function (input) {
    var opts = input || {};
    var actions = opts.actions;
    var text = ns.str(opts.text);
    var before = ns.fingerprint(W.readDraft(opts.getDraft));
    var out = baseReport('insert', before);
    var probe = W.inspect(actions);
    if (!probe.ok) {
      out.reason = probe.has ? W.MSG_CAPTURE_FAILED : W.MSG_NO_ACTIONS;
      out.rejectedAt = probe.has ? 'no-insertText-verb' : 'no-inputActions';
      W.log('write-insert', out);
      return out;
    }
    var cap = W.captureSpan(actions);
    if (!cap.ok) {
      out.reason = W.MSG_CAPTURE_FAILED + '（' + ns.str(cap.error) + '）';
      out.rejectedAt = 'captureInsertion-threw';
      out.method = 'insertText';
      W.log('write-insert', out);
      return out;
    }
    /* 同 tick：捕获与插入之间不得有 await */
    var returned = false;
    try {
      returned = actions.insertText(text, cap.span) === true;
    } catch (e) {
      out.method = 'insertText';
      out.insertTextReturned = null;
      out.rejectedAt = 'insertText-threw';
      out.reason = 'insertText 抛错：' + ns.errText(e);
      W.log('write-insert', out);
      return out;
    }
    out.method = 'insertText';
    out.insertTextReturned = returned;
    out.replaced = returned;
    var cov = W.coverage(cap.span, before.length, null);
    out.coversAll = cov.coversAll;
    out.coversAllBasis = cov.basis;
    out.endpointKeysUsed = cov.basis.endpointKeysUsed;
    out.whitelistMiss = cov.basis.whitelistMiss;
    out.revisionPresent = cov.basis.revisionPresent;
    var after = ns.fingerprint(W.readDraft(opts.getDraft));
    out.afterLength = after.length;
    out.afterHash = after.hash;
    if (returned !== true) {
      out.rejectedAt = 'insertText-returned-false';
      out.reason = 'insertText 返回假值：仅在「捕获后草稿版本未变」且「编辑器允许编辑」时插入成功（asar:403343）。请重试。';
      W.log('write-insert', out);
      return out;
    }
    /* 读回断言必须在 React 重渲染之后做（异步补做，见 W.finalizeInsert）。
       此处只标记 pending：同 tick 读到的仍是**旧草稿**，若就地判 verified 会把成功误报成未确认。 */
    out.pending = true;
    out.verified = null;
    W.log('write-insert-pending', out);
    return out;
  };

  /**
   * 异步补做插入的读回断言（由组件在下一个宏任务里调用，此时草稿已重渲染）。
   * @param {object} report W.insert 的返回
   * @param {object} ctx { beforeDraft, draftAfter, text, normalizedRange }
   */
  W.finalizeInsert = function (report, ctx) {
    var out = report && typeof report === 'object' ? report : {};
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var after = ns.fingerprint(c.draftAfter);
    out.afterLength = after.length;
    out.afterHash = after.hash;
    out.pending = false;
    if (out.insertTextReturned !== true) {
      out.verified = false;
      out.reason = out.reason || W.MSG_UNCONFIRMED;
      W.log('write-insert', out);
      return out;
    }
    var expected = W.expectedAfterInsert(ns.str(c.beforeDraft), c.normalizedRange, c.text);
    if (expected !== null) {
      out.verified = (after.hash === ns.hashText(expected) && after.length === expected.length);
      out.verifiedBy = 'expected-draft';
    } else if (ns.str(c.text) !== '' && after.hash !== ns.hashText(ns.str(c.beforeDraft))) {
      /* 选区形状在白名单外 ⇒ 退化为「草稿确实变了」的**弱判据**，并如实标注（评审 F-5：
         文案必须让用户看出这是弱判据，不能与强判据共用「已写入」） */
      out.verified = true;
      out.verifiedBy = 'draft-changed';
      out.verifiedStrength = 'weak';
      out.reason = W.MSG_INSERTED_WEAK;
    } else {
      out.verified = false;
    }
    out.reason = out.reason || (out.verified ? W.MSG_INSERTED : W.MSG_UNCONFIRMED);
    W.log('write-insert', out);
    return out;
  };

  /**
   * 异步补做替换的读回断言：整段替换后草稿应**恰好等于**写入的文本。
   * @param {object} report W.replace 的返回
   * @param {object} ctx { draftAfter, text }
   */
  W.finalizeReplace = function (report, ctx) {
    var out = report && typeof report === 'object' ? report : {};
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var after = ns.fingerprint(c.draftAfter);
    out.afterLength = after.length;
    out.afterHash = after.hash;
    out.pending = false;
    if (out.insertTextReturned !== true) {
      out.verified = false;
      out.reason = out.reason || W.MSG_UNCONFIRMED;
      W.log('write-replace', out);
      return out;
    }
    out.verified = (after.hash === ns.hashText(ns.str(c.text)) && after.length === ns.str(c.text).length);
    out.reason = out.verified ? '已替换整段草稿（可 Ctrl+Z 撤销）' : W.MSG_UNCONFIRMED;
    if (!out.verified) out.rejectedAt = 'readback-mismatch';
    W.log('write-replace', out);
    return out;
  };

  /* ── 拒绝分支（PM-NO-WRITE 区）：只有 提示 + console + return，**不含任何写入调用** ── */
  /* PM-NO-WRITE:BEGIN */
  W.refuseReplace = function (cov, before, reasonText) {
    var out = {
      action: 'replace',
      method: null,
      replaced: false,
      verified: false,
      insertTextReturned: null,
      beforeLength: before.length,
      afterLength: before.length,
      beforeHash: before.hash,
      afterHash: before.hash,
      coversAll: cov && cov.coversAll !== undefined ? cov.coversAll : 'unknown',
      coversAllBasis: cov && cov.basis ? cov.basis : null,
      endpointKeysUsed: cov && cov.basis ? cov.basis.endpointKeysUsed : null,
      excludedKeys: W.EXCLUDED_KEYS.slice(0),
      whitelistMiss: cov && cov.basis ? cov.basis.whitelistMiss : [],
      revisionPresent: cov && cov.basis ? cov.basis.revisionPresent : false,
      draftLengthAtCapture: before.length,
      noAwaitBetween: true,
      reason: ns.str(reasonText) !== '' ? ns.str(reasonText) : W.MSG_REPLACE_NEEDS_CTRL_A,
      rejectedAt: 'replace-selection-not-full-draft'
    };
    W.log('write-replace-refused', out);
    return out;
  };
  /* PM-NO-WRITE:END */

  /**
   * 替换（条件动作）：**只有**捕获到的选区覆盖整段草稿时才执行；
   * 否则走 W.refuseReplace（如实提示 Ctrl+A，且不写入任何文本）。
   */
  W.replace = function (input) {
    var opts = input || {};
    var actions = opts.actions;
    var before = ns.fingerprint(W.readDraft(opts.getDraft));
    var probe = W.inspect(actions);
    var cov = { coversAll: 'unknown', basis: null, reason: W.MSG_NO_ACTIONS };
    if (probe.ok) {
      var cap = W.captureSpan(actions);
      cov = cap.ok ? W.coverage(cap.span, before.length, null) : { coversAll: 'unknown', basis: null, reason: ns.str(cap.error) };
      if (cov.coversAll === true) {
        var text = ns.str(opts.text);
        var returned = false;
        try { returned = actions.insertText(text, cap.span) === true; } catch (e) { returned = false; }
        var after = ns.fingerprint(W.readDraft(opts.getDraft));
        var rep = baseReport('replace', before);
        rep.method = 'insertText';
        rep.insertTextReturned = returned;
        rep.replaced = returned;
        rep.coversAll = true;
        rep.coversAllBasis = cov.basis;
        rep.endpointKeysUsed = cov.basis.endpointKeysUsed;
        rep.whitelistMiss = cov.basis.whitelistMiss;
        rep.revisionPresent = cov.basis.revisionPresent;
        rep.afterLength = after.length;
        rep.afterHash = after.hash;
        if (returned !== true) {
          rep.pending = false;
          rep.verified = false;
          rep.reason = 'insertText 返回假值：仅在「捕获后草稿版本未变」且「编辑器允许编辑」时才成立（asar:403343）。';
          rep.rejectedAt = 'insertText-returned-false';
          W.log('write-replace', rep);
          return rep;
        }
        /* 读回断言异步补做（见 W.finalizeReplace）：此处只标 pending */
        rep.pending = true;
        rep.verified = null;
        rep.reason = null;
        W.log('write-replace-pending', rep);
        return rep;
      }
    }
    return W.refuseReplace(cov, before, cov && cov.reason ? cov.reason : W.MSG_REPLACE_NEEDS_CTRL_A);
  };

  /**
   * 后备：仅在「读回证明确实没写进去」时才降级 setDraft。
   * 🟥 **不得被产品路径调用**：它带 `method:'setDraft'`，一旦接回产品写入路径就正好命中 F-8 的失败判据
   *    （req-9 的 Ctrl+Z 可撤销会落空）。目前全目录零调用，仅供诊断/极端恢复。
   */
  W.fallbackSetDraft = function (input) {
    var opts = input || {};
    var actions = opts.actions;
    var text = ns.str(opts.text);
    var before = ns.fingerprint(W.readDraft(opts.getDraft));
    var out = baseReport('insert', before);
    var probe = W.inspect(actions);
    var observed = W.readDraft(opts.getDraft);
    if (observed !== before.length && observed !== undefined && typeof observed === 'string' && observed !== '' ) {
      /* 草稿里已经有内容 ⇒ 不做覆盖式写入（避免破坏用户输入） */
      out.reason = 'refused: 草稿非空，setDraft 是覆盖式语义，已放弃。';
      out.rejectedAt = 'draft-not-empty';
      W.log('write-fallback-refused', out);
      return out;
    }
    if (!probe.setDraft) {
      out.reason = 'no-setDraft-verb';
      out.rejectedAt = 'no-setDraft-verb';
      W.log('write-fallback-refused', out);
      return out;
    }
    try { actions.setDraft(text); } catch (e) {
      out.method = 'setDraft';
      out.reason = 'setDraft 抛错：' + ns.errText(e);
      out.rejectedAt = 'setDraft-threw';
      W.log('write-fallback-refused', out);
      return out;
    }
    out.method = 'setDraft';
    out.insertTextReturned = null;
    var after = ns.fingerprint(W.readDraft(opts.getDraft));
    out.afterLength = after.length;
    out.afterHash = after.hash;
    out.replaced = true;
    out.verified = (after.hash === ns.hashText(text) && after.length === text.length);
    out.reason = out.verified ? 'setDraft 后备路径已写入（读回证实）' : W.MSG_UNCONFIRMED;
    W.log('write-fallback', out);
    return out;
  };
})(__pmUi);
