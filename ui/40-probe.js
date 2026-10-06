/* ==== unit: ui-probe ==== */
/* 提示词市场 · UI 单元 40 —— 受控探针（只调 setDraft，用于定论 (A) 没写进去 / (B) 读回探针不可靠）。
 *
 * 规则（队长 + verifier 多轮修订，逐条固化）：
 *   - 草稿**非空时拒绝运行**（link 安装下探针不得破坏用户输入）；报告只记长度/哈希，**不记内容**；
 *   - **只调 `setDraft`**，本次**不调** `insertText`；
 *   - 读回点 = 1 同步 + 1 微任务 + 1 宏任务；**不加 4 次重试**；
 *   - 结论**三元**：'written' | 'not-written' | 'readback-unreliable'（`matched=false` 绝不能推出「没写」）；
 *   - `spanProbe.fields` 逐字段安全转换（字符串只给长度，仅 revision 例外给 revisionText），
 *     并给出 `coversAll` / `coversAllBasis` / `excludedKeys` / `endpointKeysUsed` / `whitelistMiss` / `revisionPresent`。
 */
(function (ns) {
  'use strict';

  var P = ns.probe = ns.probe || {};

  P.EXPECTED = '【提示词市场·受控探针】setDraft-alone';

  function pickDraft(getDraft) {
    if (typeof getDraft !== 'function') return { value: undefined, error: 'no-getDraft', method: 'no-getDraft' };
    try {
      var v = getDraft();
      if (typeof v !== 'string') return { value: undefined, error: 'draft-not-string', method: 'getDraft-not-string' };
      return { value: v, error: null, method: 'getDraft()' };
    } catch (e) {
      return { value: undefined, error: ns.errText(e), method: 'getDraft-threw' };
    }
  }

  /**
   * @param {object} input { actions, getDraft, getInputState }
   * @returns {Promise<object>} setDraftAlone 报告
   */
  P.run = function (input) {
    var opts = input || {};
    var actions = opts.actions;
    var expected = P.EXPECTED;
    var first = pickDraft(opts.getDraft);
    var fpBefore = ns.fingerprint(first.value);
    var state = null;
    var stateKeys = [];
    var stateError = null;
    if (typeof opts.getInputState === 'function') {
      try {
        state = opts.getInputState();
        stateKeys = state && typeof state === 'object' ? Object.keys(state).sort() : [];
      } catch (e) { stateError = ns.errText(e); }
    } else {
      stateError = 'no-getInputState';
    }

    /* 拒绝分支：草稿非空（只记长度，不记内容） */
    if (typeof first.value === 'string' && first.value !== '') {
      var refused = {
        refused: true,
        draftLength: first.value.length,
        beforeLength: fpBefore.length,
        beforeHash: fpBefore.hash,
        message: '探针会覆盖草稿，已拒绝运行：请先手动清空输入框（探针不替你清空）。',
        readMethod: first.method
      };
      ns.log('probe-refused', refused);
      return Promise.resolve({ setDraftAlone: refused });
    }

    var probe = ns.write.inspect(actions);
    var cap = ns.write.captureSpan(actions);
    var spanDesc = ns.write.describeSpan(cap.ok ? cap.span : null, cap.ok ? null : cap.error);
    var cov = ns.write.coverage(cap.ok ? cap.span : null, fpBefore.length, cap.ok ? null : cap.error);

    var report = {
      setDraftAlone: {
        called: false,
        before: first.value === undefined ? null : first.value,
        expected: expected,
        expectedLength: expected.length,
        readBackNow: null,
        readBackMicro: null,
        readBackAsync: null,
        matched: null,
        matchedMicro: null,
        matchedAsync: null,
        readBackError: first.error,
        readMethod: first.method,
        inputStateKeys: stateKeys,
        inputStateError: stateError,
        spanProbe: {
          kind: spanDesc.kind,
          keys: spanDesc.keys,
          revisionType: spanDesc.revisionType,
          revisionText: spanDesc.revisionText,
          captureError: spanDesc.captureError,
          fields: spanDesc.fields,
          revisionPresent: cov.basis ? cov.basis.revisionPresent : false,
          excludedKeys: ns.write.EXCLUDED_KEYS.slice(0),
          endpointKeysUsed: cov.basis ? cov.basis.endpointKeysUsed : null,
          whitelistMiss: cov.basis ? cov.basis.whitelistMiss : [],
          draftLengthAtCapture: fpBefore.length,
          noAwaitBetween: true,
          draftLength: fpBefore.length,
          selectionLength: cov.basis && cov.basis.normalizedRange ? (cov.basis.normalizedRange.max - cov.basis.normalizedRange.min) : null,
          coversAll: cov.coversAll,
          coversAllBasis: cov.basis
        },
        writeReturn: null,
        beforeLength: fpBefore.length,
        beforeHash: fpBefore.hash,
        afterLength: fpBefore.length,
        afterHash: fpBefore.hash,
        replaced: false,
        verified: false,
        conclusion: 'readback-unreliable'
      }
    };
    var out = report.setDraftAlone;

    if (!probe.setDraft) {
      out.readBackError = 'no-setDraft-verb';
      out.conclusion = 'readback-unreliable';
      ns.log('probe', report);
      return Promise.resolve(report);
    }

    /* 只调 setDraft（本次绝不调 insertText） */
    out.called = true;
    try {
      var r = actions.setDraft(expected);
      out.writeReturn = { type: typeof r, value: (typeof r === 'number' || typeof r === 'boolean' || typeof r === 'string') ? r : null };
    } catch (e) {
      out.writeReturn = { type: 'threw', value: null };
      out.readBackError = ns.errText(e);
    }

    function read(which) {
      var s = pickDraft(opts.getDraft);
      var v = s.value;
      if (s.error) out.readBackError = s.error;
      out[which] = v === undefined ? null : v;
      return v === expected;
    }
    out.matched = read('readBackNow');

    return Promise.resolve().then(function () {
      out.matchedMicro = read('readBackMicro');
    }).then(function () {
      return new Promise(function (resolve) {
        try { globalThis.setTimeout(resolve, 0); } catch (e) { resolve(); }
      });
    }).then(function () {
      out.matchedAsync = read('readBackAsync');
      var fpAfter = ns.fingerprint(out.readBackAsync);
      out.afterLength = fpAfter.length;
      out.afterHash = fpAfter.hash;
      /* 三元结论：读回不可靠时绝不推出「没写」 */
      var reliable = (out.readMethod === 'getDraft()') && !(out.readBackError && out.readBackError !== 'no-getInputState') && stateKeys.length > 0;
      if (!reliable) {
        out.conclusion = 'readback-unreliable';
      } else if (out.matched === true || out.matchedMicro === true || out.matchedAsync === true) {
        out.conclusion = 'written';
      } else {
        out.conclusion = 'not-written';
      }
      out.verified = out.conclusion === 'written';
      if (out.conclusion === 'written') {
        out.replaced = false; /* 探针只写 setDraft，不代表产品路径执行了 replace */
      }
      ns.log('probe', report);
      return report;
    });
  };
})(__pmUi);
