/**
 * 提示词市场（Prompt Market）— Host 半身（最小可装载实现）。
 *
 * 装载链：profile 的 cordis.patch.yml 里那条 `name: 'dsh-prompt-market'` 的
 * insert 行会被 Loader 解析成本包的入口 → 按 package.json 的 `exports["."]`
 * 导入本文件 → 读取 `name` / `inject` / `apply` 并挂载 fiber。
 *
 * 为什么保留一个「空 apply」：
 *   - 包必须持有 Loader 可见的一行，dsh-client-modules 才会为它提供浏览器半身；
 *   - 但当前 Host 侧不需要任何服务（零后端），所以 apply 里什么都先不做。
 *
 * 交给 t-data（数据层）的落点说明：
 *   - 一旦 Host 侧要使用服务（如 ctx.web / ctx.storage / ctx.fs），**必须**把服务名
 *     写进下面的 `inject` 数组；Cordis 会把未声明服务的 fiber 保持 PENDING，
 *     表现为「插件静默不激活」；
 *   - 浏览器半身与 Host 半身的通信走 `host.call(method, args)`（见 CONSTRAINTS-01 §E），
 *     本文件届时需要注册对应的方法处理器。
 *
 * 注意：本文件是 ESM（package.json 有 `"type": "module"`），不要写成
 * `module.exports`，也不要 import 任何 @deepseek-ai/* 运行时包。
 */

/** 插件名（Loader 行 id 之外的稳定标识）。 */
export const name = 'prompt-market'

/**
 * Host 侧服务依赖。空数组 = 无硬依赖，任何组合下都能激活。
 * 需要服务时按服务键填写，例如 ['web', 'storage']。
 */
export const inject = []

/**
 * 装配入口。
 *
 * @param {object} ctx Cordis 上下文（Host 侧）
 * @param {Record<string, unknown>} config 来自 cordis.patch.yml 该行的 `config`
 * @returns {void}
 */
export function apply(ctx, config) {
  // 最小实现：不注册任何服务，仅占位以保证本包拥有一个可解析的 Loader 行。
  void ctx
  void config
}
