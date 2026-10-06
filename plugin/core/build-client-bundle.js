/* =============================================================================
 * plugin/core/build-client-bundle.js — 【可选看护工具 · 非必需】client.js 装配核对
 * =============================================================================
 * ⚠️ 定位：本脚本**不是**插件可用性的前置条件。`plugin/core/browser.js` 本身就是
 *    免构建、可直接内联的成品源码；不跑本脚本，只要内联内容正确，插件照样工作。
 *
 * 标记的两个层级（**不要再混为一谈** —— v2 修正点之一）：
 *   层级 1 · 外壳区段界定符（来自 `plugin/ui/80-client-shell.js` 模板，**必须存在**）：
 *     `PM-CORE-INLINE:BEGIN/END`、`PM-UI-INLINE:BEGIN/END`
 *   层级 2 · 单元边界标记（位于区段**内部**，9 个数据单元各一对）：
 *     `BEGIN inlined file: <name>` / `END inlined file: <name>`
 *   两者**同时存在才正确**；v1 把层级 1 误报为"旧口径标记"，会让人以为装配写错了。
 *
 * `--check` 做什么（v2 修正后的行为）：
 *   1. 先取 client.js 的 `PM-CORE-INLINE` **区段**（**不是**从文件头开始）；
 *   2. 再在该区段内取「首 `BEGIN inlined file:` → 末 `END inlined file:`」= 数据层内容；
 *   3. 与 `plugin/core/browser.js` 的同一区段做**去缩进/去空行**后的逐行比对；
 *   4. 计数与"首个不一致"**全部基于这两个区段**
 *      （v1 缺陷：拿区段长度与**整文件**长度做比、并把整文件第 1 行报成"首个不一致"，
 *       两个数字不可比 ⇒ 即便内容一致也会给出误导性结论）。
 *
 * 退出码：0 = 区段一致（或装配尚未开始）；1 = 不一致 / 文件缺失。
 * ⚠️ 只读：本脚本不写任何文件。
 * ⚠️ 命令未实测：本会话无命令执行面（见 docs/ENV-01 §1.1），下面这行命令**尚未实跑**：
 *     node "plugin/core/build-client-bundle.js" --check      （在仓库根目录运行）
 * ========================================================================== */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browserPath = join(here, 'browser.js');
const clientPath = join(dirname(here), 'client.js');

/* 层级 1：外壳区段界定符 */
const SHELL_CORE_BEGIN = 'PM-CORE-INLINE:BEGIN';
const SHELL_CORE_END = 'PM-CORE-INLINE:END';
/* 层级 2：单元边界标记（纯子串，不锚定装饰符/列位/`.js` 后缀 —— bootstrap 没有后缀） */
const UNIT_BEGIN = 'BEGIN inlined file:';
const UNIT_END = 'END inlined file:';

/* 期望的数据层单元（顺序 = 拼装顺序） */
const EXPECTED_UNITS = ['constants.js', 'text.js', 'filter.js', 'storage.js',
  'normalize.js', 'net.js', 'sources.js', 'api.js', 'bootstrap'];

function normalizeForCompare(s) {
  return String(s)
    .split('\n')
    .map((l) => l.replace(/^\s+/, '').replace(/\s+$/, ''))
    .filter((l) => l !== '')
    .join('\n');
}

/** 取两个标记之间的内容（不含标记本身）；任一缺失返回 null。 */
function sliceBetween(source, from, to) {
  const a = source.indexOf(from);
  if (a < 0) return null;
  const b = source.indexOf(to, a + from.length);
  if (b < 0) return null;
  return source.slice(a + from.length, b);
}

/** 取「首 BEGIN inlined file: → 末 END inlined file:」整段（含标记及其收尾 `*/`）。 */
function unitRegion(source) {
  const a = source.indexOf(UNIT_BEGIN);
  if (a < 0) return null;
  const b = source.lastIndexOf(UNIT_END);
  if (b < a) return null;
  const tail = source.indexOf('*/', b);
  return source.slice(a, tail >= 0 ? tail + 2 : source.length);
}

/** 按出现顺序取出区段内的单元名。 */
function unitNamesInOrder(source) {
  const names = [];
  let idx = 0;
  for (;;) {
    const at = source.indexOf(UNIT_BEGIN, idx);
    if (at < 0) return names;
    const rest = source.slice(at + UNIT_BEGIN.length);
    const close = rest.indexOf('*/');
    names.push(rest.slice(0, close >= 0 ? close : rest.length).trim());
    idx = at + UNIT_BEGIN.length;
  }
}

/** 某子串首次出现所在行（1 基）。 */
function lineOf(source, needle) {
  const at = source.indexOf(needle);
  if (at < 0) return -1;
  let line = 1;
  for (let i = 0; i < at; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function reportFirstDiff(expected, got) {
  const av = expected.split('\n');
  const bv = got.split('\n');
  for (let i = 0; i < av.length; i++) {
    if (i >= bv.length || av[i] !== bv[i]) {
      process.stderr.write('  数据层区段内首个不一致：第 ' + (i + 1) + ' 行（去缩进/去空行后计数）\n');
      process.stderr.write('    期望 "' + String(av[i]).slice(0, 110) + '"\n');
      process.stderr.write('    实得 ' + (i < bv.length ? '"' + String(bv[i]).slice(0, 110) + '"' : '(缺失)') + '\n');
      return;
    }
  }
  process.stderr.write('  行内容逐一相同，但行数不同（期望 ' + av.length + ' / 实得 ' + bv.length + '）\n');
}

async function main() {
  if (!existsSync(browserPath)) {
    process.stderr.write('[pm-core] FAILED: 找不到 ' + browserPath + '\n');
    return 1;
  }
  if (!existsSync(clientPath)) {
    process.stderr.write('[pm-core] SKIP: 还没有 ' + clientPath + '，装配未开始；这不一定是错误。\n');
    return 0;
  }

  const browser = await readFile(browserPath, 'utf8');
  const client = await readFile(clientPath, 'utf8');
  const clientLines = client.split('\n').length;

  /* ── 1) 外壳区段界定符（仅缺失时才提示；存在则静默） ─────────────────── */
  const shellCoreOk = client.indexOf(SHELL_CORE_BEGIN) >= 0 && client.indexOf(SHELL_CORE_END) >= 0;
  if (!shellCoreOk) {
    process.stderr.write('[pm-core] 提示: client.js 缺少外壳区段界定符 '
      + SHELL_CORE_BEGIN + ' / ' + SHELL_CORE_END
      + '（来自 plugin/ui/80-client-shell.js），无法判定装配是否完整。\n');
    process.stderr.write('  注意：它与层级 2 的单元标记 `' + UNIT_BEGIN
      + '<name>` 是两个层级，需要同时存在；二者不冲突。\n');
  }

  /* ── 2) 取 client.js 的 PM-CORE-INLINE 区段（v2 的核心修正） ─────────── */
  const coreRegionClient = sliceBetween(client, SHELL_CORE_BEGIN, SHELL_CORE_END);
  if (coreRegionClient === null) {
    process.stderr.write('[pm-core] SKIP: client.js 里找不到 ' + SHELL_CORE_BEGIN + ' … '
      + SHELL_CORE_END + ' 区段，无法定位数据层；装配可能尚未开始。\n');
    return 0;
  }
  const regionStartLine = lineOf(client, SHELL_CORE_BEGIN);
  const regionEndLine = lineOf(client, SHELL_CORE_END);

  /* ── 3) 区段内的单元区段（层级 2） ──────────────────────────────────── */
  const segClient = unitRegion(coreRegionClient);
  if (segClient === null) {
    process.stderr.write('[pm-core] SKIP: PM-CORE-INLINE 区段内没有 `' + UNIT_BEGIN
      + '<name>` 单元标记；装配可能尚未开始。\n');
    return 0;
  }
  const segBrowser = unitRegion(browser);
  if (segBrowser === null) {
    process.stderr.write('[pm-core] FAILED: ' + browserPath + ' 里找不到 `' + UNIT_BEGIN
      + '<name>` 单元标记，无法比对。\n');
    return 1;
  }

  /* ── 4) 单元名与顺序 ─────────────────────────────────────────────────── */
  const namesClient = unitNamesInOrder(segClient);
  const namesBrowser = unitNamesInOrder(segBrowser);
  const missing = EXPECTED_UNITS.filter((u) => namesClient.indexOf(u) < 0);
  const orderOk = namesClient.length === namesBrowser.length
    && namesClient.every((n, i) => n === namesBrowser[i]);

  if (missing.length > 0) {
    process.stderr.write('[pm-core] FAILED: PM-CORE-INLINE 区段缺少单元：' + missing.join(', ') + '\n');
    process.stderr.write('  区段内实际单元（' + namesClient.length + ' 个）：' + namesClient.join(' → ') + '\n');
    return 1;
  }
  if (!orderOk) {
    process.stderr.write('[pm-core] FAILED: 单元顺序与 browser.js 不一致。\n');
    process.stderr.write('  client.js : ' + namesClient.join(' → ') + '\n');
    process.stderr.write('  browser.js: ' + namesBrowser.join(' → ') + '\n');
    return 1;
  }

  /* ── 5) 逐行比对（去缩进 / 去空行） ──────────────────────────────────── */
  const expected = normalizeForCompare(segBrowser);
  const got = normalizeForCompare(segClient);
  const expLines = expected.split('\n').length;
  const gotLines = got.split('\n').length;

  process.stdout.write('[pm-core] client.js 共 ' + clientLines + ' 行；PM-CORE-INLINE 区段 = 行 '
    + regionStartLine + '-' + regionEndLine + '\n');
  process.stdout.write('[pm-core] 数据层区段：' + namesClient.length + ' 个单元（'
    + namesClient.join(' → ') + '），去缩进后 ' + gotLines + ' 行\n');

  if (expected === got) {
    process.stdout.write('[pm-core] --check OK: PM-CORE-INLINE 区段与 browser.js 逐行一致'
      + '（' + gotLines + ' 行内容 / ' + namesClient.length + ' 个单元 / 顺序一致）\n');
    return 0;
  }

  process.stderr.write('[pm-core] --check FAILED: PM-CORE-INLINE 区段与 browser.js 不一致（可能已过期）。\n');
  process.stderr.write('  区段行数：期望 ' + expLines + ' / 实得 ' + gotLines
    + '（两个数字都取自**区段**，与整文件行数不可比 —— v2 修正点）\n');
  reportFirstDiff(expected, got);
  process.stderr.write('  修复：把 plugin/core/browser.js 的全部内容原样重新放入 PM-CORE-INLINE 区段。\n');
  return 1;
}

main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  process.stderr.write('[pm-core] FAILED: ' + ((e && e.stack) || e) + '\n');
  process.exitCode = 1;
});
