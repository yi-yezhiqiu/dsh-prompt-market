/* =============================================================================
 * core/node-reader.js — 仅 Node 可用的源码读取器
 * =============================================================================
 * ⚠️ 本文件**只在 Node（Host 半身 / verifier / 静态自检）侧被动态 import**：
 *     core/index.js 用 `await import('./node-reader.js')` 调用它。
 *     浏览器侧永远不会解析到这一行（那条 import 是动态的，且被 try/catch 包住），
 *     因此浏览器半身不需要、也无法加载本文件。
 *
 * 为什么需要它：
 *   8 个核心文件刻意写成「无 ESM 语法」的经典脚本形态（浏览器 ModuleLoader
 *   bundle 没有编译步骤，无法解析相对路径模块请求）。为了让 ESM 侧也能拿到
 *   同一份源码，这里把文件读成字符串，交给 index.js 的 evaluate() 沙箱求值。
 *
 * 约束：本文件只做「读文件」，不做任何求值，不产生副作用。
 * ========================================================================== */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** 本目录的绝对路径（由 import.meta.url 推导）。 */
export function coreDir() {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * 读取核心文件源码。
 * @param {string[]} fileNames 例如 ['constants.js', 'text.js', …]
 * @returns {Promise<Array<{name:string, source:string}>>} 顺序与入参一致；**读不到的文件会跳过**并附带 error 标记
 */
export async function readCoreSources(fileNames) {
  const list = Array.isArray(fileNames) ? fileNames : [];
  const dir = coreDir();
  const out = [];
  for (const name of list) {
    try {
      const source = await readFile(join(dir, name), 'utf8');
      out.push({ name, source });
    } catch (e) {
      out.push({ name, source: '', error: (e && e.message) ? e.message : String(e) });
    }
  }
  return out;
}
