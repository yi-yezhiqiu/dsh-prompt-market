/* ==== unit: ui-theme ==== */
/* 提示词市场 · UI 单元 10 —— 主题 token 白名单、样式表、样式安装。
 *
 * 颜色纪律（CONSTRAINTS-01 §D + asar:292610 作者规则）：
 *   - 颜色 **100%** 走 var(--dsw-*)；**禁止** hex / rgb / hsl / 颜色兜底；
 *   - 只使用 §D 的 14 个 token；light/dark 两套由 DSH 主题自动切换，插件不自造两套值；
 *   - class 一律 pm_ 前缀；不 import 任何 @deepseek-ai/* 客户端包。
 */
(function (ns) {
  'use strict';

  /* CONSTRAINTS-01 §D 的 14 个 token（静态脚本断言 var() 参数必须落在此表内） */
  ns.TOKENS = [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-overlay',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-idle-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-specific-sidebar-fill'
  ];

  ns.CSS = [
    '.pm_root{position:relative;display:inline-flex;align-items:center;gap:6px}',
    '.pm_btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:6px;',
    'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
    'color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}',
    '.pm_btn:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
    '.pm_btn[disabled]{color:var(--dsw-alias-state-idle-primary);cursor:not-allowed}',
    '.pm_btn_primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);',
    'color:var(--dsw-alias-bg-layer-1);font-weight:600}',
    '.pm_btn_ghost{background:transparent;border-color:var(--dsw-alias-border-l1)}',
    '.pm_panel{position:absolute;left:0;right:0;bottom:calc(100% + 8px);margin:0 auto;max-width:720px;',
    'min-width:520px;max-height:min(60vh,520px);display:flex;flex-direction:column;overflow:hidden;',
    'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
    'border:1px solid var(--dsw-alias-border-l2);border-radius:10px;font-size:13px;z-index:40}',
    '.pm_panel_fixed{position:fixed;left:50%;transform:translateX(-50%);bottom:96px}',
    '.pm_head{display:flex;align-items:center;gap:4px;padding:6px 8px;',
    'background:var(--dsw-specific-sidebar-fill);border-bottom:1px solid var(--dsw-alias-border-l1)}',
    '.pm_tab{padding:4px 10px;border-radius:6px;border:1px solid transparent;cursor:pointer;',
    'color:var(--dsw-alias-label-secondary);background:transparent;font-size:12px}',
    '.pm_tab_on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);',
    'background:var(--dsw-alias-bg-layer-1);font-weight:600}',
    '.pm_spacer{flex:1 1 auto}',
    '.pm_toolbar{display:flex;align-items:center;gap:6px;padding:6px 8px;flex-wrap:wrap;',
    'border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay)}',
    '.pm_input,.pm_select{height:26px;padding:0 6px;border-radius:6px;font-size:12px;',
    'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
    'color:var(--dsw-alias-label-primary);outline:none}',
    '.pm_input{flex:1 1 160px;min-width:120px}',
    '.pm_input:focus,.pm_select:focus{border-color:var(--dsw-alias-brand-primary)}',
    '.pm_status{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:11px;',
    'color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}',
    '.pm_badge{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;',
    'background:var(--dsw-alias-bg-layer-2)}',
    '.pm_bar{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:12px;border-radius:6px;',
    'margin:6px 8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
    '.pm_bar_error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
    '.pm_bar_warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
    '.pm_bar_ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
    '.pm_list{overflow:auto;flex:1 1 auto;padding:4px 8px}',
    '.pm_row{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:8px;',
    'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);margin-bottom:6px}',
    '.pm_row_sel{border-color:var(--dsw-alias-brand-primary)}',
    '.pm_grow{flex:1 1 auto;min-width:0}',
    '.pm_title{color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pm_desc{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45;',
    'max-height:32px;overflow:hidden}',
    '.pm_meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
    '.pm_chip{font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);',
    'border-radius:999px;padding:0 6px;background:var(--dsw-alias-bg-layer-2)}',
    '.pm_chip_on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
    '.pm_empty{padding:18px 8px;text-align:center;color:var(--dsw-alias-state-idle-primary)}',
    '.pm_err{color:var(--dsw-alias-state-error-primary)}',
    '.pm_warn{color:var(--dsw-alias-state-warn-primary)}',
    '.pm_ok{color:var(--dsw-alias-state-success-primary)}',
    '.pm_mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all}',
    '.pm_pre{max-height:150px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;',
    'padding:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
    'font-size:11px;white-space:pre-wrap;word-break:break-word}',
    '.pm_foot{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:11px;',
    'border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
    '.pm_field{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}',
    '.pm_label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
    '.pm_mask{position:fixed;inset:0;background:var(--dsw-alias-bg-base);opacity:0.82;z-index:50}',
    '.pm_dlg{position:fixed;left:50%;top:12vh;transform:translateX(-50%);width:560px;max-height:70vh;',
    'overflow:auto;z-index:51;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
    'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);padding:10px}',
    '.pm_row_actions{display:flex;flex-direction:column;gap:4px}',
    '.pm_srclist{display:flex;flex-direction:column;gap:6px;padding:6px 8px;overflow:auto}',
    '.pm_src{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;',
    'background:var(--dsw-alias-bg-layer-1)}',
    '.pm_kv{display:flex;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}'
  ].join('\n');

  var STYLE_ID = 'pm-style';
  var installed = null;

  /**
   * 安装样式。顺序：ctx.styles.insert(css) → 自建 <style data-pm-style> → 放弃（行内 style 兜底）。
   * 幂等；绝不抛错。
   */
  ns.installStyles = function (ctx) {
    if (installed) return installed;
    var css = ns.CSS;
    try {
      if (ctx && ctx.styles && typeof ctx.styles.insert === 'function') {
        ctx.styles.insert(css);
        installed = 'ctx.styles.insert';
        return installed;
      }
    } catch (e) { /* 退化到 <style> */ }
    try {
      var doc = globalThis.document;
      if (doc && doc.head) {
        if (doc.getElementById && doc.getElementById(STYLE_ID)) { installed = 'style-exists'; return installed; }
        var el = doc.createElement('style');
        el.setAttribute('data-pm-style', '1');
        el.id = STYLE_ID;
        el.appendChild(doc.createTextNode(css));
        doc.head.appendChild(el);
        installed = 'style-tag';
        return installed;
      }
    } catch (e2) { /* 忽略 */ }
    installed = 'none';
    return installed;
  };

  ns.stylesInstalledVia = function () { return installed; };
})(__pmUi);
