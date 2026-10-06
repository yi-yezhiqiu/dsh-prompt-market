/* ==== unit: ui-client-shell ==== */
/* 提示词市场 · UI 单元 80（**装配模板，不是运行入口**）—— plugin/client.js 的外壳骨架。
 *
 * 用途：集成环节把两个内联区填满即可得到自包含的 client.js（DSH 的唯一客户端入口）：
 *   ① PM-CORE-INLINE 区 ← plugin/core/browser.js 的 **9 个单元体**（constants.js … bootstrap），原样顶格；
 *   ② PM-UI-INLINE 区   ← plugin/ui/00-core.js … 70-entry.js 共 **8 个单元**，按此顺序、原样顶格。
 * 两个区都只放「完整语句」，因此**每填一个单元后 client.js 仍是合法 JS**（link 安装下次启动即生效，
 * 不允许出现半成品被加载）。
 *
 * ⚠️ 归属：plugin/client.js 属 t2 产物，**不在 t4 的 in-scope 路径内**（t4 in-scope = plugin/ui/）。
 *    本文件只是模板；真正的装配动作由集成任务（t9）或队长指派的执行者完成。
 *    模板本身放在 plugin/ui/ 下、不参与 dist、也不会被 DSH 加载（package.json 的入口是 client.js）。
 *
 * 预期最终形态（装配后）：
 *   window.__ModuleLoader__.load({
 *     id: 'dsh-prompt-market',                 // 必须等于 package.json 的 name（asar:378891）
 *     factory: require => {
 *       const React = require('react');        // shell 冻结模块表；不得 require 其它包
 *       PM-CORE-INLINE 区 …
 *       PM-UI-INLINE 区 …
 *       return { apply: globalThis.__pmUi.apply, inject: globalThis.__pmUi.inject, name: 'prompt-market' };
 *     }
 *   })
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-market',
  factory: require => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');

    /* PM-CORE-INLINE:BEGIN */
    /* 此处粘贴 plugin/core/browser.js 的 9 个单元体（含各自的 BEGIN/END inlined file 注释），原样顶格。 */
    /* PM-CORE-INLINE:END */

    /* PM-UI-INLINE:BEGIN */
    /* 此处按序粘贴 plugin/ui/00-core.js … 70-entry.js 的 8 个单元，原样顶格。 */
    /* PM-UI-INLINE:END */

    exports.apply = globalThis.__pmUi.apply;
    exports.inject = globalThis.__pmUi.inject;
    exports.name = 'prompt-market';
    return module.exports;
  }
});
