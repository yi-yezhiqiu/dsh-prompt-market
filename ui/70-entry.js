/* ==== unit: ui-entry ==== */
/* 提示词市场 · UI 单元 70 —— 装载入口：注册两个槽位条目、安装样式。
 *
 * 槽位（CONSTRAINTS-01 §C）：
 *   - conversation.input.left    → 「提示词导入」按钮
 *   - conversation.input.overlay → 浮层市场面板
 * 两个条目各自套一个错误边界（渲染抛错 ⇒ 错误态，不白屏；asar:292610）。
 */
(function (ns) {
  'use strict';

  /* React 由 ModuleLoader factory 的 require 提供：本单元与其它 UI 单元被内联在**同一个 factory** 里，
     `require` 在其词法作用域内可见；若被独立加载（诊断用途）则保持 ns.React 原样。 */
  if (!ns.React && typeof require === 'function') {
    try { ns.React = require('react'); } catch (e) { ns.React = null; }
  }
  ns.h = ns.React && typeof ns.React.createElement === 'function' ? ns.React.createElement : null;

  ns.inject = ['slots'];

  ns.apply = function (ctx) {
    var stylesVia = 'none';
    try { stylesVia = ns.installStyles(ctx); } catch (e) { /* 样式失败不阻断装载（行内 style 兜底） */ }
    if (!ns.h) {
      ns.log('entry-error', { message: 'React 不可用：无法注册界面（不抛错，避免整块空白）' });
      return;
    }
    var Boundary = ns.makeBoundary();
    try {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        ns.log('entry-error', { message: 'ctx.slots 不可用' });
        return;
      }
      ctx.slots.inject(ns.SLOT_BUTTON, function () {
        return ctx.slots.register(
          { name: ns.SLOT_BUTTON, id: ns.ENTRY_BUTTON, order: 80, label: '提示词导入' },
          function (props) { return ns.h(Boundary, { slot: ns.SLOT_BUTTON }, ns.h(ns.ImportButton, props)); }
        );
      });
      ctx.slots.inject(ns.SLOT_PANEL, function () {
        return ctx.slots.register(
          { name: ns.SLOT_PANEL, id: ns.ENTRY_PANEL, order: 80, label: '提示词市场' },
          function (props) { return ns.h(Boundary, { slot: ns.SLOT_PANEL }, ns.h(ns.MarketPanel, props)); }
        );
      });
    } catch (e) {
      ns.log('entry-error', { message: ns.errText(e) });
    }
    ns.log('client-half-active', {
      version: ns.VERSION,
      slotButton: ns.SLOT_BUTTON,
      slotPanel: ns.SLOT_PANEL,
      styles: stylesVia,
      dataReady: ns.dataReady().ok
    });
  };
})(__pmUi);
