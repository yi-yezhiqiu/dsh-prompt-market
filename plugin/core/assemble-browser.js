/* =============================================================================
 * plugin/core/assemble-browser.js — 【可选工具】由核心文件拼装 plugin/core/browser.js
 * =============================================================================
 * ⚠️ 不是插件可用性的前置条件：
 *    `plugin/core/browser.js` 已经落盘并自包含（9 个单元 + 头 + 尾）。
 *    本脚本只在「改了 plugin/core/*.js 需要重新生成 browser.js」或
 *    「想校验 browser.js 是否与核心文件一致」时使用。
 *
 * ⚠️ 命令未实测：本会话（队内）没有任何命令执行面（pwsh 返回
 *    `SetNamedSecurityInfoW failed (Win32 5)`，见 docs/ENV-01 §1.1），
 *    因此下面这些命令**尚未在任何真实终端跑过**，属「未实测」。
 *
 * 用法（用户终端，未实测）：
 *   node "…\plugin\core\assemble-browser.js"            # 生成/覆盖 browser.js
 *   node "…\plugin\core\assemble-browser.js" --verify   # 只校验，不改文件
 *   node "…\plugin\core\assemble-browser.js" --list     # 只打印单元清单与行数
 *
 * 退出码：0 = 成功/一致；1 = 失败/不一致。
 *
 * 拼装规则（与 docs/DATA-01-数据层接口.md §2.5 一致）：
 *   头（本文件内嵌 HEADER 常量）
 *   → 9 个单元，每个 = 一行 BEGIN 标记 + 单元体 + 一行 END 标记
 *     单元顺序固定：constants text filter storage normalize net sources api bootstrap
 *     constants…api 的单元体 = 对应核心文件的**逐字节原文**（仅 CRLF→LF、去尾空行）；
 *     bootstrap 的单元体 = 本文件内嵌 BOOTSTRAP 常量（它没有对应核心文件）。
 * ========================================================================== */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, 'browser.js');

/* 固定拼装顺序（常量区 → 门面 → 引导） */
const CORE_UNITS = ['constants.js', 'text.js', 'filter.js', 'storage.js', 'normalize.js', 'net.js', 'sources.js', 'api.js'];
const UNIT_NAMES = CORE_UNITS.concat(['bootstrap']);

const HEADER = `/* =============================================================================
 * plugin/core/browser.js — 提示词市场 · 数据层【浏览器半身成品源码】（免构建）
 * =============================================================================
 * 这是什么
 *   DSH 桌面端「提示词市场」插件的数据层，**可直接被浏览器执行、可直接内联**的
 *   自包含纯 JS 模块。零 require、零相对路径、零构建步骤、零外部依赖。
 *
 * 怎么用（t-ui / uismith 必读）
 *   把本文件**全部内容原样、顶格**放进 \`plugin/client.js\`（放在
 *   window.__ModuleLoader__.load({ ... factory: require => { ... } }) 的 factory 里，
 *   或直接放在该 load 调用之前）。**不需要任何构建步骤，也不需要跑任何脚本。**
 *   执行后 globalThis.__pmCore 即数据层；也可用 globalThis.__pmCore.getMarket()。
 *
 *   可选看护工具（**不是前置条件**）：
 *     node "plugin/core/assemble-browser.js" --verify     # 校验本文件与核心文件一致
 *     node "plugin/core/build-client-bundle.js" --check   # 校验 client.js 内联内容与本文件一致
 *   上述命令在本会话**未实测**（队内无命令执行面），仅作出厂前自检建议。
 *
 * 三条硬约束（改本文件前必读）
 *   1) 不含被本机阻断的 raw 域名；默认地址一律 cdn.jsdelivr.net，
 *      api.github.com 只作 base64 兜底（CONSTRAINTS-01 §A）。
 *   2) 不使用模板字面量（反引号）、不使用 import/export —— 无编译步骤，源码即产物。
 *   3) 不 require 任何东西，不引用相对路径，不调用 host.call（队长裁决第 4 条）。
 *
 * 组成（**顶格书写**，每个单元都是独立完整语句；顺序固定，勿重排）
 *   单元名           内容
 *   constants        真值：源 URL/字段、许可正文、配额、过滤名单、错误码
 *   text             纯文本化、实体解码、哈希、安全 JSON、原型污染防护
 *   filter           可配置内容过滤（默认开启）
 *   storage          持久化 + schemaVersion 迁移护栏 + 配额护栏 + 缓存
 *   normalize        RFC4180 CSV 解析 + 四适配器 + 统一模型
 *   net              URL 拼装、超时、重试退避、429 容忍、base64 兜底
 *   sources          源注册表 + 单源降级管线 + 多源聚合
 *   api              门面（search / fav / custom / tags / sources / settings / filter / licenses / data / diag）
 *   bootstrap        把命名空间挂到 globalThis.__pmCore，并给出便捷方法名
 *
 *   每对 \`BEGIN inlined file: <name>\` / \`END inlined file: <name>\` 标记对应一个单元；
 *   各单元的行数登记在 \`plugin/core/.linecount.txt\`（不在本文件里重复写数字，
 *   避免两处数字漂移）。
 * ========================================================================== */
`;

const BOOTSTRAP = `/* =============================================================================
 * unit: bootstrap — 把命名空间挂到宿主全局，并给出便捷方法名
 * =============================================================================
 * 这是**唯一**写宿主全局的单元（其余 8 个单元只写各自的局部命名空间对象）。
 * 它同时给出与任务书措辞一致的便捷方法名（listSources / fetchPrompts / search /
 * favorites / import / export / filter …），见 docs/DATA-01-数据层接口.md §2.5。
 * ============================================================================= */

(function (root) {
  'use strict';

  var ns = root.__pmCore;
  if (!ns || !ns.api || !ns.constants) {
    /* 8 个单元没加载成功时，暴露一个可展示的错误对象而不是抛错（避免白屏） */
    root.__pmCoreBrowserError = {
      ok: false,
      code: 'E_BOOTSTRAP',
      message: '数据层未加载完整：缺少 __pmCore.api / __pmCore.constants。请确认 browser.js 的 8 个单元都已内联。'
    };
    return;
  }

  var market = null;
  function getMarket() {
    if (!market) market = ns.api.getShared({});
    return market;
  }

  /* 便捷：模块级单例初始化结果 */
  var initResult = null;
  function initOnce(options) {
    var m = getMarket();
    if (!initResult) initResult = m.init(options);
    return initResult;
  }

  ns.browser = true;
  ns.getMarket = getMarket;
  ns.initOnce = initOnce;
  ns.createDataLayer = function (options) { return ns.api.createDataLayer(options || {}); };

  /* ---- 便捷方法名（全部返回同样的结果对象；不抛错） ---------------------- */
  ns.listSources = function () {
    initOnce();
    return getMarket().sources.list();
  };
  ns.testSource = function (sourceId, options) {
    initOnce();
    return getMarket().sources.test(sourceId, options);
  };
  ns.addSource = function (input) {
    initOnce();
    return getMarket().sources.add(input);
  };
  ns.removeSource = function (sourceId) {
    initOnce();
    return getMarket().sources.remove(sourceId);
  };
  ns.fetchPrompts = function (query) {
    initOnce();
    return getMarket().search(query || {});
  };
  ns.search = ns.fetchPrompts;
  ns.favorites = function () {
    initOnce();
    return getMarket().fav.list();
  };
  ns.toggleFavorite = function (item) {
    initOnce();
    return getMarket().fav.toggle(item);
  };
  ns.myPrompts = function () {
    initOnce();
    return getMarket().custom.list();
  };
  ns.createPrompt = function (input) {
    initOnce();
    return getMarket().custom.create(input);
  };
  ns.filterInfo = function () {
    initOnce();
    return getMarket().filter.get();
  };
  ns.setFilterEnabled = function (enabled) {
    initOnce();
    return getMarket().filter.setEnabled(enabled);
  };
  ns.notices = function () {
    initOnce();
    return getMarket().licenses.notice();
  };
  ns.exportJSON = function (options) {
    initOnce();
    return getMarket().data.exportJSON(options);
  };
  ns.importJSON = function (input, options) {
    initOnce();
    return getMarket().data.importJSON(input, options);
  };
  ns.settings = function () {
    initOnce();
    return getMarket().settings.get();
  };
  ns.updateSettings = function (patch) {
    initOnce();
    return getMarket().settings.update(patch);
  };
  ns.diagnostics = function () {
    initOnce();
    return getMarket().diagnose ? getMarket().diagnose() : getMarket().diag.selfDescribe();
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

function lf(text) {
  return String(text).replace(/\r\n/g, '\n');
}

function trimTrailingNewlines(text) {
  return lf(text).replace(/\n+$/, '');
}

function normalizeForCompare(text) {
  return lf(text)
    .split('\n')
    .map((l) => l.replace(/^\s+/, '').replace(/\s+$/, ''))
    .filter((l) => l !== '')
    .join('\n');
}

function fnv1a32(text) {
  const bytes = Buffer.from(lf(text), 'utf8');
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

async function build() {
  const chunks = [trimTrailingNewlines(HEADER)];
  const manifest = [];
  for (const unit of UNIT_NAMES) {
    let body;
    if (unit === 'bootstrap') {
      body = trimTrailingNewlines(BOOTSTRAP);
    } else {
      body = trimTrailingNewlines(await readFile(join(here, unit), 'utf8'));
    }
    manifest.push({ unit, lines: body.split('\n').length, hash: fnv1a32(body) });
    chunks.push('');
    chunks.push('/* BEGIN inlined file: ' + unit + ' */');
    if (unit === 'bootstrap') {
      /* bootstrap 没有核心文件；它的说明头已在 BOOTSTRAP 常量里 */
      chunks.push(body);
    } else {
      /* 核心文件的头注释里写的是 `plugin/core/<name>.js`；保持原样即可（便于区对区比对） */
      chunks.push(body);
    }
    chunks.push('/* END inlined file: ' + unit + ' */');
  }
  chunks.push('');
  return { source: chunks.join('\n'), manifest };
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--verify') ? 'verify' : (argv.includes('--list') ? 'list' : 'write');
  const built = await build();

  if (mode === 'list') {
    process.stdout.write('[assemble-browser] 单元清单\n');
    for (const m of built.manifest) {
      process.stdout.write('  ' + m.unit.padEnd(16) + ' ' + String(m.lines).padStart(5) + ' 行  ' + m.hash + '\n');
    }
    process.stdout.write('  合计 ' + trimTrailingNewlines(built.source).split('\n').length + ' 行 / '
      + Buffer.byteLength(built.source, 'utf8') + ' 字节\n');
    return 0;
  }

  if (mode === 'verify') {
    if (!existsSync(target)) {
      process.stderr.write('[assemble-browser] --verify FAILED: 找不到 ' + target + '\n');
      return 1;
    }
    /* 只比较 BEGIN/END 标记之间的内容（头/尾的说明文字允许单独演进，不算漂移） */
    const sliceUnits = (s) => {
      const first = s.indexOf('BEGIN inlined file:');
      const last = s.lastIndexOf('END inlined file:');
      return (first < 0 || last < 0) ? s : s.slice(first, last);
    };
    const actual = normalizeForCompare(sliceUnits(await readFile(target, 'utf8')));
    const expected = normalizeForCompare(sliceUnits(built.source));
    if (actual === expected) {
      process.stdout.write('[assemble-browser] --verify OK: browser.js 的 9 个单元与核心文件逐行一致\n');
      for (const m of built.manifest) {
        process.stdout.write('  ' + m.unit.padEnd(16) + ' ' + String(m.lines).padStart(5) + ' 行  ' + m.hash + '\n');
      }
      return 0;
    }
    process.stderr.write('[assemble-browser] --verify FAILED: browser.js 的单元内容与核心文件不一致（已过期）。\n');
    const av = expected.split('\n');
    const bv = actual.split('\n');
    for (let i = 0; i < av.length; i++) {
      if (i >= bv.length || av[i] !== bv[i]) {
        process.stderr.write('  首个不一致：期望第 ' + (i + 1) + ' 行 "' + String(av[i]).slice(0, 100) + '"\n');
        process.stderr.write('              实得 ' + (i < bv.length ? '"' + String(bv[i]).slice(0, 100) + '"' : '(缺失)') + '\n');
        break;
      }
    }
    return 1;
  }

  await writeFile(target, built.source, 'utf8');
  process.stdout.write('[assemble-browser] OK: 已写出 ' + target + '\n');
  for (const m of built.manifest) {
    process.stdout.write('  ' + m.unit.padEnd(16) + ' ' + String(m.lines).padStart(5) + ' 行  ' + m.hash + '\n');
  }
  process.stdout.write('  合计 ' + trimTrailingNewlines(built.source).split('\n').length + ' 行 / '
    + Buffer.byteLength(built.source, 'utf8') + ' 字节\n');
  process.stdout.write('  提示：接着跑 `--verify`，以及 `node build-client-bundle.js --check` 看 client.js 是否过期。\n');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  process.stderr.write('[assemble-browser] FAILED: ' + ((e && e.stack) || e) + '\n');
  process.exitCode = 1;
});
