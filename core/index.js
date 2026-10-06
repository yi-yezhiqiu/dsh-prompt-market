/* =============================================================================
 * core/index.js — 数据层加载入口
 * =============================================================================
 * 本文件承担三件事：
 *
 * A) **ESM 加载（Host 半身 / verifier 用）**
 *    `import { load } from './core/index.js'` → load() 依次「沙箱求值」7 个核心
 *    文件，返回命名空间对象 `{ constants, text, filter, storage, normalize,
 *    net, sources, api }`。
 *
 *    为什么用「读源码 + 沙箱求值」而不是 ESM import/export：
 *      浏览器半身持有的是**手写 ModuleLoader bundle**（无编译步骤），无法解析
 *      相对路径的模块请求（CONSTRAINTS-01 §E；ENV-01 §2.2）。因此 7 个核心文件
 *      统一写成「无 ESM 语法、只往 globalThis 上挂命名空间」的形态，
 *      两种运行环境共用同一份源码，**零构建、零分叉**。
 *      沙箱求值让 ESM 侧拿到**独立副本**，不会与浏览器侧共享可变状态
 *      （各 Host/客户端实例天然隔离）。
 *
 * B) **浏览器内联（`core/build-client-bundle.js` 用）**
 *    同目录的 builder 用 buildClientSource() 生成一段直接可跑的 IIFE，
 *    供 t-ui 把数据层**内联**进 ModuleLoader bundle 的 factory 里。
 *
 * C) **静态自检**：node --check 本文件即可验证语法；load() 在无 Node API 的
 *    环境里也能用（只要把文件内容喂给 evaluate()）。
 *
 * 纪律：本文件是**唯一**允许出现 ESM 语法的核心文件；其余 7 个文件严禁出现
 *       `import` / `export`（客户端静态自检脚本会断言这一点）。
 * ========================================================================== */

/** 核心文件加载顺序（顺序即依赖顺序，勿随意调整）。 */
export const CORE_FILES = [
  'constants.js',
  'text.js',
  'filter.js',
  'storage.js',
  'normalize.js',
  'net.js',
  'sources.js',
  'api.js'
];

/** 期望出现在命名空间上的键（自检脚本用它断言每个文件都成功挂载）。 */
export const CORE_NAMESPACES = ['constants', 'text', 'filter', 'storage', 'normalize', 'net', 'sources', 'api'];

function createShim(namespace) {
  /* 浏览器/宿主都有的运行时全局透传名单；其余键由核心文件自己挂载 */
  const passthrough = [
    'fetch', 'localStorage', 'sessionStorage', 'window', 'document', 'navigator',
    'location', 'console', 'AbortController', 'Blob', 'URL', 'FileReader',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'TextEncoder', 'TextDecoder', 'performance'
  ];
  const shim = {
    get __pmCore() { return namespace; },
    set __pmCore(v) { return v; }
  };
  for (const key of passthrough) {
    Object.defineProperty(shim, key, {
      enumerable: false,
      configurable: true,
      get() {
        try { return globalThis[key]; } catch (e) { return undefined; }
      },
      set(v) { return v; } // 忽略：核心文件不写这些键
    });
  }
  return shim;
}

/**
 * 在隔离作用域里求值一组核心文件源码。
 * @param {Array<{name:string, source:string}>} files
 * @returns {{ ok:boolean, namespace:object, loaded:string[], errors:Array<{name:string,message:string}> }}
 *          **永不抛错**；某个文件求值失败只记录 errors，其余文件继续加载。
 */
export function evaluate(files) {
  const namespace = {};
  const shim = createShim(namespace);
  const loaded = [];
  const errors = [];

  for (const file of files) {
    const name = file && file.name ? file.name : '(anonymous)';
    const source = file && typeof file.source === 'string' ? file.source : '';
    if (source === '') {
      errors.push({ name, message: '源码为空' });
      continue;
    }
    let body = null;
    try {
      /* 每个文件一个独立 function 作用域；globalThis 参数在函数体内遮蔽真实全局，
         使核心文件只写到我们提供的 shim 上（浏览器侧则写真实 globalThis）。 */
      body = new Function('globalThis', source + '\n;return globalThis;');
    } catch (compileError) {
      errors.push({ name, message: '语法错误：' + (compileError && compileError.message ? compileError.message : String(compileError)) });
      continue;
    }
    try {
      body(shim);
      loaded.push(name);
    } catch (runtimeError) {
      errors.push({ name, message: '求值抛错：' + (runtimeError && runtimeError.message ? runtimeError.message : String(runtimeError)) });
    }
  }

  const missing = CORE_NAMESPACES.filter((key) => !namespace[key]);
  if (missing.length > 0) {
    errors.push({ name: '(约定)', message: '未挂载命名空间：' + missing.join(', ') });
  }

  return { ok: errors.length === 0, namespace, loaded, errors };
}

async function readCoreFilesNode() {
  /* Node 才有的分支：用动态 import 规避浏览器解析 "./node-reader.js" 的失败 */
  const reader = await import('./node-reader.js');
  return reader.readCoreSources(CORE_FILES);
}
/**
 * 加载数据层。
 * @param {object} [options]
 *   - files: Array<{name, source}> 显式提供源码（浏览器/测试可用）
 *   - readSources: () => Promise<Array<{name, source}>> 自定义读取器
 * @returns {Promise<{ ok:boolean, core:object, loaded:string[], errors:Array, how:string }>}
 */
export async function load(options = {}) {
  let files = null;
  let how = 'unset';

  if (Array.isArray(options.files)) {
    files = options.files;
    how = 'explicit-files';
  } else if (typeof options.readSources === 'function') {
    files = await options.readSources();
    how = 'custom-reader';
  } else {
    try {
      files = await readCoreFilesNode();
      how = 'node-fs';
    } catch (e) {
      return {
        ok: false,
        core: null,
        loaded: [],
        how: 'unavailable',
        errors: [{
          name: '(loader)',
          message: '无法在 Node 侧读取核心源码（' + (e && e.message ? e.message : String(e))
            + '）。若在浏览器里，请改用 buildClientSource() 内联，或显式传 options.files。'
        }]
      };
    }
  }

  const result = evaluate(files);
  if (result.ok) {
    /* 便捷单例：Host 侧一般直接用这个 */
    try {
      if (result.namespace.api && typeof result.namespace.api.getShared === 'function') {
        result.namespace.market = result.namespace.api.getShared({});
      }
    } catch (e) {
      result.errors.push({ name: '(bootstrap)', message: '创建默认数据层实例失败：' + (e && e.message ? e.message : String(e)) });
    }
  }
  return { ok: result.ok, core: result.namespace, loaded: result.loaded, errors: result.errors, how };
}

/** 顶层便捷导出：await loadCore() 等价于 (await load()).core。 */
export async function loadCore(options) {
  const r = await load(options);
  return r.core;
}

/**
 * 生成浏览器侧可内联的源码（给 build-client-bundle.js 使用）。
 *
 * 产出是一段**表达式**：`(function (namespace) { … return namespace; })({})`。
 * 它把 8 个核心文件按顺序内联进同一个作用域，并把 `namespace` 变量**遮蔽**
 * `globalThis`，因此：
 *   - 与宿主环境不共享可变状态；
 *   - 不会污染真实 `globalThis`；
 *   - 浏览器调用方拿到的是可直接用的 `__pmCore` 命名空间对象。
 *
 * ⚠️ 只做**逐行缩进**，不做任何行合并/拼接 —— 这样块注释与行注释都保持安全。
 *
 * @param {Array<{name:string, source:string}>} files
 * @returns {string}
 */
export function buildClientSource(files) {
  const chunks = [];
  chunks.push('(function (namespace) {');
  chunks.push("  'use strict';");
  chunks.push('  var globalThis = namespace; // 遮蔽：核心文件只写到本命名空间上');
  for (const file of files) {
    const name = file && file.name ? file.name : '(anonymous)';
    chunks.push('  /* ==== inlined: ' + name + ' ==== */');
    const lines = String(file.source || '').split('\n');
    for (const line of lines) chunks.push('  ' + line);
    chunks.push('  /* ==== end: ' + name + ' ==== */');
  }
  chunks.push('  return namespace;');
  chunks.push('})({})');
  return chunks.join('\n');
}
