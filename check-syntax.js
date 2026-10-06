/* check-syntax.js — 语法检查：遍历仓库内全部 .js，逐个用 Node 自己的解析器校验。
 *
 * 用法：node check-syntax.js
 * 退出码：0 = 全部通过；1 = 有文件解析失败
 *
 * 为什么不用 `new Function`：仓库里既有 ESM（index.js / core/index.js / core/node-reader.js）
 * 也有 IIFE 脚本，`new Function` 只对后者有效。直接调 `node --check`（即 Node 的解析器）
 * 对两类都正确。
 *
 * 有意跳过：core/.browser-parts/{head,tail}.js —— 它们是拼装 browser.js 用的**片段**，
 * 单独拿出来不是合法 JS（缺少前后文）。报错属预期，不是缺陷。
 *
 * 实现细节：子进程的 stdout/stderr 重定向到临时**文件**而非管道 ——
 * 某些受限环境（如 DSH 的文件沙箱）禁止创建命名管道，用管道会让 spawn 直接 EPERM。
 */
import { readdirSync, statSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_SUFFIX = [join('core', '.browser-parts', 'head.js'), join('core', '.browser-parts', 'tail.js')];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      files.push(p);
    }
  }
})('.');

const logPath = join(tmpdir(), 'dsh-pm-check-syntax-' + process.pid + '.log');
let failed = 0;
let checked = 0;
const skipped = [];

for (const f of files.sort()) {
  const rel = relative('.', f).split(sep).join('/');
  if (SKIP_SUFFIX.some((s) => rel.endsWith(s.split(sep).join('/')))) {
    skipped.push(rel);
    continue;
  }
  checked++;
  const fd = openSync(logPath, 'w');
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    console.log('  [OK] ' + rel);
  } catch (e) {
    closeSync(fd);
    failed++;
    const detail = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(0, 3).join('\n         ');
    console.log('  [XX] ' + rel);
    if (detail) console.log('         ' + detail);
  }
}
try { unlinkSync(logPath); } catch (e) { /* 忽略 */ }

console.log('');
if (skipped.length > 0) {
  console.log('skipped (assembly fragments, not standalone JS): ' + skipped.join(', '));
}
console.log('checked ' + checked + ' file(s); failed ' + failed);
process.exitCode = failed > 0 ? 1 : 0;
