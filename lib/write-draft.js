/**
 * 提示词市场（Prompt Market）— 写入通道：可复用写入函数（浏览器半身专用）。
 *
 * 任务来源：t2 [implementation]「试验打通：用 inputActions.setDraft 把文本写进输入框」
 * 契约：docs/CONTRACTS-01-任务验收契约.md · t-spike
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 无编译约束
 * ────────────────────────────────────────────────────────────────────────────
 * 本文件是**源码即产物**（ENV-01 §3）：本环境无法执行任何构建，因此
 *   - 必须是纯 JS（无 JSX / 无 TS），
 *   - **不得**出现 `import` / `export`（浏览器半身是手写 ModuleLoader bundle，
 *     client.js 通过 `require()` 只取 shell 冻结模块表里的键）。
 * 因此这里采用「挂到 window 命名空间」的单文件写法，由 client.js 在 factory
 * 内部 `require('./lib/write-draft.js')` 之外的方式加载 —— 见 §加载方式说明。
 *
 * ⚠️ 重要（t-ui 必读）：本文件**不能**用 ESM `export`。client.js 的 factory 里
 * 没有文件系统，ModuleLoader 的 `require` 只解析 shell 冻结模块表（react 等），
 * **不解析相对路径**。所以本文件按下面的方式暴露 API，二选一：
 *
 *   路线 A（推荐，t-ui 采用）：把本文件的函数体**内联**进 client.js 的 factory。
 *   路线 B：把本文件当成一个独立的 `<script>` 资源由 loader 预加载（本环境未证实）。
 *
 * 为了让「内联」这一步零成本，本文件被包成 IIFE，**把三个函数挂到
 * `globalThis.__promptMarketWrite`**；内联时直接拷贝 `var __promptMarketWrite = (function(){…})()`
 * 那一段即可，不依赖任何模块系统。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 运行时契约（全部取自 app.asar 原文，逐行可复核）
 * ────────────────────────────────────────────────────────────────────────────
 * `InputActions` 是槽位组件 props 上的一个**稳定标准 prop**，不是 ctx 服务：
 *   - asar:403216 / 403388 `ui-conversation … contributes the useConversation,
 *     useInput, and inputActions standard props through ctx.uiSession.`
 *   - asar:421672-421685 `ctx.uiSession.provide({ hooks:["conversation","input"],
 *     props:["inputActions"], resolve: … { props:{ inputActions: shell.actions } } })`
 *     ← **prop 的名字就是 `inputActions`**（本任务的 Q2 由这四行直接回答）
 *   - asar:421070 `renderSlot("conversation.input.left", {})`
 *     ← 左槽位**没有 owner props**，所以 inputActions **只能**来自标准 prop 注入
 *
 * 三个动作的实现（asar:417008-417026，`shell.actions` 字面量）：
 *   - `captureInsertion: () => ({ ...this.caretSpan(), revision: … })`
 *   - `insertText: (text, span) => this.draftEditor.insertAsyncText(span, text)`
 *   - `setDraft: (text) => { this.setDraft(text) }` → `draftEditor.setDraft(text)`
 * 官方语义（asar:403343 英 / 403515 中，逐字）：
 *   `captureInsertion() 捕获草稿选区与版本；insertText(text, span) 仅在版本未变
 *    且编辑器允许编辑时，插入一次可撤销的纯文本编辑。异步消费者在插入被拒绝后
 *    负责保留结果，等待用户操作。`
 *
 * 官方插件真在用（asar:821664-821890，客户端内置语音输入）：
 *   821761 `if (!inputActions.insertText(result.value.text, active.span)) {`
 *   821780 `span: inputActions.captureInsertion(),`
 *   821883 `if (inputActions.insertText(pending, inputActions.captureInsertion())) {`
 */

var __promptMarketWrite = (function () {
  'use strict'

  /** 调用结果的可判别形状（给调用方做「拒绝而不抛错」的处理）。 */
  function result(ok, method, extra) {
    var out = { ok: ok, method: method }
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k]
      }
    }
    return out
  }

  /** 仅在真正需要「拼接」时才追加空行，避免重复插入时堆积换行。 */
  function appendSeparated(existing, text) {
    if (typeof existing !== 'string' || existing === '') return text
    if (existing.slice(-2) === '\n\n') return existing + text
    if (existing.slice(-1) === '\n') return existing + '\n' + text
    return existing + '\n\n' + text
  }

  /**
   * 探测 inputActions 是否真的可用（**不做任何写入**）。
   * UI 层应当在渲染按钮时调用它决定「可插入 / 置灰」。
   *
   * @param {object|undefined|null} inputActions props.inputActions
   * @returns {{ok:boolean, has:boolean, setDraft:boolean, insertText:boolean, captureInsertion:boolean}}
   */
  function inspectInputActions(inputActions) {
    var probe = {
      ok: false,
      has: false,
      setDraft: false,
      insertText: false,
      captureInsertion: false
    }
    if (inputActions === null || typeof inputActions !== 'object') {
      // 左槽位的 inputActions 是标准 prop，缺省时为 undefined；不是异常状态，
      // 但绝不能对它做属性取值（asar:292610：组件抛错 = 槽位整块空白）。
      return probe
    }
    probe.has = true
    probe.setDraft = typeof inputActions.setDraft === 'function'
    probe.insertText = typeof inputActions.insertText === 'function'
    probe.captureInsertion = typeof inputActions.captureInsertion === 'function'
    probe.ok = probe.setDraft || (probe.insertText && probe.captureInsertion)
    return probe
  }

  /**
   * 读取当前草稿文本（用于「写完后是否真的入框」的实测断言）。
   * 走 `useInput()` 的标准快照 hook —— **必须在 React 组件里调用**，
   * 不能在普通函数里调用。
   *
   * @param {Function} useInput props.useInput（来自 ui-conversation 的标准 hook）
   * @returns {string|undefined} 读不到时返回 undefined（不抛错）
   */
  function readDraft(useInput) {
    if (typeof useInput !== 'function') return undefined
    try {
      var state = useInput(function (s) {
        return s
      })
      if (state === null || typeof state !== 'object') return undefined
      return typeof state.draft === 'string' ? state.draft : undefined
    } catch (error) {
      return undefined
    }
  }

  /**
   * 把文本写进输入框草稿。**这是本任务交付的「可直接复用的写入函数」。**
   *
   * 降级顺序（与 t2 任务书完全一致）：
   *   ① `inputActions.setDraft(text)`  —— 首选。整段设定，不依赖 span/版本。
   *      **返回契约未知**（asar:417018-417019 只给出签名与转调 `(text) => { this.setDraft(text) }`，
   *      函数体无法成行取证），且官方文档（asar:403343 / 403515）只为 `insertText` 规定了返回值、
   *      **没有**为 `setDraft` 规定返回契约 → 所以**不能**用它判断成功，判定靠读回草稿（assertDraft）。
   *   ② `inputActions.insertText(text, captureInsertion())` —— 降级。**布尔返回**，
   *      但只在「版本未变 且 编辑器允许编辑」时成功；被拒时返回 false。
   *
   * ⚠️ 语义差异（写进报告，调用方必须知道）：
   *   - `setDraft` = **覆盖**整段草稿（用 appendText 可改为追加）。
   *   - `insertText` = 在捕获的选区**插入/替换**一段可撤销文本。
   *   两者对「已存在的草稿」结果不同；面板里点一个提示词时，产品语义应为
   *   「替换或追加」，见 `appendText` 选项。
   *
   * **绝不抛错**（asar:292610：槽位组件抛错会整块空白）。失败即 `ok:false` + `reason`。
   *
   * @param {object} input
   * @param {object|undefined|null} input.inputActions `props.inputActions`（左槽位标准 prop）
   * @param {string} input.text 要写入的文本（必须是字符串；其它类型一律拒绝）
   * @param {boolean} [input.appendText=false] true=追加到现有草稿，false=覆盖
   * @param {string|undefined} [input.existingDraft]
   *        已知的当前草稿。两个用途：
   *        ① appendText=true 时作为拼接基准；
   *        ② **覆盖模式下 setDraft 抛错时，用于判定"到底写没写进去"**——
   *           这正是 `writeAndVerify` 会可靠传入它的原因（见下方降级闸门）。
   * @param {Function} [input.readDraft]
   *        可选的读回回调（`function(): string|undefined`）。
   *        **只在** setDraft 抛错、需要判断能否安全降级时才会被调用；
   *        与 `existingDraft` 配合决定是否放行 insertText 降级。
   *        `writeAndVerify` 会自动提供它；直接调 `writeText` 的调用方
   *        若不提供，则"setDraft 抛错"一律不降级（宁可失败也不写两遍）。
   * @returns {{ok:boolean, method:string|null, reason?:string, rejectedAt?:string, recovered?:boolean}}
   */
  function writeText(input) {
    var opts = input || {}
    var actions = opts.inputActions
    var text = opts.text

    if (typeof text !== 'string') {
      return result(false, null, { reason: 'bad-text: text 必须是 string，收到 ' + typeof text })
    }

    var probe = inspectInputActions(actions)
    if (!probe.has) {
      return result(false, null, {
        reason:
          'no-input-actions: props.inputActions 为 undefined。' +
          '本槽位的 inputActions 是 uiSession 提供的标准 prop，' +
          '未加载/未挂载该会话时缺省即 undefined（无可归咎的插件缺陷）。'
      })
    }
    if (!probe.ok) {
      return result(false, null, {
        reason:
          'no-write-verb: 既无 setDraft，也没有 insertText+captureInsertion 组合；' +
          '实测到的键 = ' + Object.keys(actions).join(',')
      })
    }

    var payload = text
    if (opts.appendText === true) {
      payload = appendSeparated(opts.existingDraft, text)
    }

    /** setDraft 抛错时记录其原因（undefined = 没抛错 / 或根本没用 setDraft）。 */
    var setDraftFailure = null

    // ── ① 首选：setDraft ────────────────────────────────────────────────────
    if (probe.setDraft) {
      try {
        actions.setDraft(payload)
        return result(true, 'setDraft')
      } catch (error) {
        // setDraft 抛错 —— 只记录，不抛错，继续评估能否降级。
        // 注意：抛错**不等于**没写进去（可能"写成功后才出错"），所以不能无条件降级；
        // 降级闸门见下方。
        setDraftFailure = error && error.message ? error.message : String(error)
      }
    }

    // ── 降级闸门：setDraft 抛错时，能不能安全地改用 insertText？──────────────
    // 只有在「能读回草稿、且读回值确实不是期望值」时才降级。
    // 理由：insertText 是在**光标处插入**，而不是覆盖；若 setDraft 其实已经生效，
    // 再插一次就会把文本写两遍。所以在拿不到读回能力时，宁可停在 setDraft 上。
    var allowFallback = probe.insertText && probe.captureInsertion && !setDraftFailure
    if (setDraftFailure) {
      var observed = typeof opts.readDraft === 'function' ? opts.readDraft() : undefined
      var canCompare = observed !== undefined && typeof opts.existingDraft === 'string'
      if (canCompare && observed !== payload) allowFallback = probe.insertText && probe.captureInsertion
    }

    // ── ② 降级：insertText(text, captureInsertion()) ────────────────────────
    if (allowFallback) {
      var span
      try {
        span = actions.captureInsertion()
      } catch (error) {
        return result(false, 'insertText', {
          rejectedAt: 'captureInsertion-threw',
          reason:
            'captureInsertion threw: ' + (error && error.message ? error.message : String(error))
        })
      }
      var inserted
      try {
        inserted = actions.insertText(payload, span)
      } catch (error) {
        inserted = false
        return result(false, 'insertText', {
          rejectedAt: 'insertText-threw',
          reason:
            'insertText threw: ' + (error && error.message ? error.message : String(error))
        })
      }
      if (inserted === true) {
        // 从 setDraft 的失败里恢复成功 —— 明确告诉调用方"这是一次降级恢复"。
        return result(true, 'insertText', setDraftFailure ? { recovered: true } : undefined)
      }
      return result(false, 'insertText', {
        rejectedAt: 'insertText-returned-false',
        reason:
          'insertText 返回假值：按 asar:403343 的契约，只有「捕获后草稿版本未变」' +
          '且「编辑器允许编辑」时才插入一次可撤销编辑。' +
          '常见成因：await / 异步等待期间用户改了草稿（版本推进）、' +
          '编辑器处于不可编辑态（提交中、审批接管 composer、输入区 locked）。' +
          '处理：保留结果等待用户操作（不要重试同一个 span）。' +
          (setDraftFailure ? '（本次是 setDraft 抛错后的降级：' + setDraftFailure + '）' : '')
      })
    }

    // 走到这里 = 没有可用动词，或 setDraft 抛错且降级闸门未放行。
    if (setDraftFailure) {
      return result(false, 'setDraft', {
        rejectedAt: 'setDraft-threw',
        reason:
          'setDraft threw: ' + setDraftFailure +
          '；且未能安全降级到 insertText（需要 insertText+captureInsertion，' +
          '并且要能读回草稿以确认 setDraft 确实没生效——否则可能把文本写两遍）。'
      })
    }

    return result(false, null, { reason: 'unreachable' })
  }

  /**
   * 「写入并断言」：调 writeText 之后再读回草稿，判断文本是否真的入框。
   *
   * 这是把验收判据（草稿是否真实入框）变成机器可判定结论的唯一可靠方式：
   * `setDraft` 无返回值，`insertText` 的 true 只代表「这一次编辑被接受」，
   * 都不等于「草稿里现在有这段文本」。
   *
   * ⚠️ `assertDraft` 依赖 `useInput`，**必须在 React 组件内**调用。
   * 若拿不到 useInput（例如在非组件上下文里），传入 `assertDraft:false`，
   * 只返回写入动作的结果。
   *
   * @param {object} input 同 writeText，外加
   * @param {Function} [input.useInput] props.useInput（用于读回断言）
   * @param {boolean} [input.assertDraft=true] 是否做读回断言
   * @returns {{ok:boolean, method:string|null, wrote:boolean, verified:boolean|null,
   *            draft:string|undefined, reason?:string, rejectedAt?:string,
   *            before:string|undefined, after:string|undefined}}
   */
  function writeAndVerify(input) {
    var opts = input || {}
    var wantAssert = opts.assertDraft !== false && typeof opts.useInput === 'function'

    var before = wantAssert ? readDraft(opts.useInput) : undefined

    // 组一份**不修改调用方对象**的内部入参：把 before 交给 writeText 当
    // existingDraft（拼接基准 + setDraft 抛错时的降级闸门判据），并把读回能力
    // 暴露成 readDraft()，让 writeText 能在必要时复核。
    var inner = { readDraft: function () { return readDraft(opts.useInput) } }
    for (var k in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, k)) inner[k] = opts[k]
    }
    if (wantAssert) inner.existingDraft = before

    var outcome = writeText(inner)
    var after = wantAssert ? readDraft(opts.useInput) : undefined

    var verified = null
    var expected = opts.appendText === true ? appendSeparated(before, opts.text) : opts.text
    if (wantAssert) verified = after === expected

    var finalOk = outcome.ok && (verified === null ? true : verified === true)
    var report = {
      ok: finalOk,
      method: outcome.method,
      wrote: outcome.ok,
      verified: verified,
      draft: after,
      before: before,
      after: after
    }
    if (outcome.reason) report.reason = outcome.reason
    if (outcome.rejectedAt) report.rejectedAt = outcome.rejectedAt
    if (outcome.recovered === true) report.recovered = true
    if (verified === false) {
      report.reason =
        'write-accepted-but-draft-mismatch: 写入动作被接受（method=' +
        String(outcome.method) +
        '），但读回草稿与期望不符。期望=' +
        JSON.stringify(expected) +
        ' 实得=' +
        JSON.stringify(after)
    }
    return report
  }

  return {
    writeText: writeText,
    writeAndVerify: writeAndVerify,
    inspectInputActions: inspectInputActions,
    readDraft: readDraft,
    appendSeparated: appendSeparated
  }
})()

/** 供 client.js 内联时取用；也便于在 DevTools 里手工调用做探查。 */
globalThis.__promptMarketWrite = __promptMarketWrite
