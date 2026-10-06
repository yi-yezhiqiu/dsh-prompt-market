/* =============================================================================
 * plugin/core/constants.js — 提示词市场 · 数据层常量与内置源注册表
 * =============================================================================
 * 用途：把「硬编码的真值」集中在唯一的文件里，供适配器、持久化、过滤、文档
 *       与静态自检脚本共同引用。任何 URL / 字段名 / 许可事实都来自
 *       docs/CONSTRAINTS-01-团队约束清单.md §B 与 docs/REL-01-数据源许可核查报告.md，
 *       **禁止改写、禁止臆造新 URL**。
 *
 * 运行形态（全核心包一致）：
 *   - 浏览器半身：作为普通脚本被注入后立即执行；跨文件共享挂在一个命名空间对象上。
 *   - Host 半身：由 plugin/core/index.js 用「沙箱求值 + 捕获命名空间」的方式加载，
 *     因此本文件**不得**依赖 Node 专有全局（process / require / __dirname）。
 *
 * ⚠️ 硬规则（CONSTRAINTS-01 §A，**判据口径见下**）：
 *   1) 所有内置默认地址一律 cdn.jsdelivr.net；
 *   2) 产品代码中的**可请求 URL** 一律不得指向 raw.githubusercontent.com
 *      （本行本身即警告文本：注释、自检夹具、断言常量里出现该域名字面量**不算违规**；
 *       判据是「不得把它当作可请求地址」，不是「字符序列不得出现」）；
 *   3) api.github.com 只作 base64 兜底，且必须容忍 429（匿名 60 次/小时/IP）。
 *
 * ⚠️ 语言子集约束（无编译步骤，源码即产物）：
 *   不使用模板字面量（反引号）、不使用 import/export、不使用可选链 / 空值合并不等于
 *   老解析器可用 —— 本包统一用 ES2017 以下子集 + 字符串拼接，降低风险。
 * ========================================================================== */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  /* ---------------------------------------------------------------------------
   * 1) 构建身份
   * ------------------------------------------------------------------------ */
  var APP_ID = 'dsh-prompt-market';
  var DATA_API_MAJOR = 1;

  /* ---------------------------------------------------------------------------
   * 2) 源类型
   * ------------------------------------------------------------------------ */
  var SOURCE_KIND = {
    CSV: 'csv',
    SHORTCUT_JSON: 'shortcut-json',
    PROMPTS_ZH_JSON: 'prompts-zh-json',
    CUSTOM_JSON: 'custom-json'
  };

  var SOURCE_ORIGIN = {
    BUILTIN: 'builtin',
    CUSTOM: 'custom'
  };

  /* ---------------------------------------------------------------------------
   * 3) 统一归一化模型（对外契约，见 docs/DATA-01-数据层接口.md §3）
   * ------------------------------------------------------------------------ */
  var ITEM_FIELDS = [
    'uid',          // 稳定唯一键：sourceId + ':' + nativeId（缺失原生主键时用内容哈希）
    'id',           // 兼容别名，值恒等于 uid
    'sourceId',     // 所属源 id
    'nativeId',     // 上游主键：B1=行序号，B2=id，B3=行序号
    'title',        // 标题：B1=act，B2=<locale>.title，B3=act
    'content',      // ★ 写入输入框的正文：B1=prompt，B2=<locale>.prompt，B3=prompt
    'body',         // 兼容别名，值恒等于 content（DSH-01 §5.1 用的名字）
    'tags',         // 字符串数组
    'lang',         // 'en' | 'zh' | 其他
    'author',       // B1=contributor；其余可为 null
    'description',  // B2=<locale>.description
    'remark',       // B2=<locale>.remark
    'weight',       // B2=weight（默认排序用）
    'forDevs',      // B1=for_devs
    'type',         // B1=type
    'website',      // 上游来源链接，可为 null
    'sourceUrl',    // 该条目可回溯的源地址（默认 = 源首页）
    'license',      // { id, name, url, attribution }
    'sanitized',    // 是否发生过 HTML 剥离/转义（远程内容一律纯文本处理）
    'contentHash'   // FNV-1a 32bit 内容哈希（去重与缓存比对）
  ];

  /* ---------------------------------------------------------------------------
   * 4) 内置源注册表（CONSTRAINTS-01 §B 逐条落地）
   *
   * urlTemplate 里的 {ref} 会被 ref（默认 'main'，或 api.github.com 取到的 commit sha）
   * 替换。filePath 是仓库内路径，与 fileUrlPrefix 拼成候选地址。
   * ------------------------------------------------------------------------ */
  var CDN = {
    /* 唯一的默认 CDN 前缀（禁止改成 raw 域名） */
    JSDELIVR: 'https://cdn.jsdelivr.net/gh/',
    /* 仅用于「锁定 commit sha」与「超限 base64 兜底」；匿名限流 60/h，必须容忍 429 */
    GITHUB_API: 'https://api.github.com/'
  };

  var BUILTIN_SOURCES = [
    {
      id: 'prompts-chat-csv',
      name: '英文提示词库（prompts.chat）',
      kind: SOURCE_KIND.CSV,
      origin: SOURCE_ORIGIN.BUILTIN,
      enabled: true,
      removable: false,
      lang: 'en',
      repo: 'f/prompts.chat',
      filePath: 'prompts.csv',
      ref: 'main',
      /* 首选：jsDelivr；兜底：api.github.com contents（base64），仅在 enabledFallback 时使用 */
      enabledFallback: true,
      /* B1 的实际字段（RFC4180 CSV 表头，逐字，勿改） */
      csvHeader: ['act', 'prompt', 'for_devs', 'type', 'contributor'],
      homepage: 'https://github.com/f/prompts.chat',
      licenseId: 'CC0-1.0',
      licenseNote: '提示词数据（prompts.csv / PROMPTS.md）按 CC0 1.0 捐赠至公有领域，可无条件内置；'
        + '不需要署名，但产品约定必须标注来源。',
      supportsWeight: false,
      notes: [
        '该仓库不存在 JSON 版本（prompts.json 实测 404），勿再尝试。',
        'prompt 字段含换行与内嵌双引号，必须走 RFC4180 解析器，不可 split(",")。',
        'contributor 可为逗号分隔多值，故在 CSV 中被引号包裹。'
      ]
    },
    {
      id: 'chatgpt-shortcut-zh',
      name: '中文提示词库（ChatGPT-Shortcut）',
      kind: SOURCE_KIND.SHORTCUT_JSON,
      origin: SOURCE_ORIGIN.BUILTIN,
      enabled: true,
      removable: false,
      lang: 'zh',
      repo: 'rockbenben/ChatGPT-Shortcut',
      filePath: 'src/data/prompt_zh-Hans.json',
      ref: 'main',
      enabledFallback: true,
      /* 实测体量 423,972 B（REL-01 §2.2），仅此一个语种文件被内置 */
      locale: 'zh-Hans',
      /* 该文件的 prompt 多为英文原文，中文主要在 description / remark */
      promptIsMostlyEnglish: true,
      homepage: 'https://github.com/rockbenben/ChatGPT-Shortcut',
      licenseId: 'MIT',
      licenseNote: 'MIT，Copyright (c) 2023 rockbenben。分发必须保留版权声明与许可正文，'
        + '并注明来源 URL；该库含 DAN 越狱与成人角色扮演条目，必须默认开启内容过滤。',
      supportsWeight: true,
      notes: [
        '对象键即语种（zh-Hans）；字段为 <locale>.{title,prompt,description,remark} + website/tags/id/weight。',
        '仅取 zh-Hans 一个键，避免一次解析 18 个语种。',
        'id 是稳定主键（非数组下标）；去重优先按 id，其次按 prompt 文本哈希。'
      ]
    },
    {
      id: 'plexpt-prompts-zh',
      name: '中文提示词库（awesome-chatgpt-prompts-zh）',
      kind: SOURCE_KIND.PROMPTS_ZH_JSON,
      origin: SOURCE_ORIGIN.BUILTIN,
      enabled: true,
      removable: false,
      lang: 'zh',
      repo: 'PlexPt/awesome-chatgpt-prompts-zh',
      filePath: 'prompts-zh.json',
      ref: 'main',
      enabledFallback: true,
      /* 实测体量 62,741 B，字段仅 act + prompt（REL-01 §2.6 B3） */
      fields: ['act', 'prompt'],
      homepage: 'https://github.com/PlexPt/awesome-chatgpt-prompts-zh',
      licenseId: 'MIT-plexpt',
      licenseNote: 'MIT，Copyright (c) 2025 plex（上游 LICENSE 逐字，经 cdn.jsdelivr.net 镜像复核）。标题与正文均为中文，可直接写入；'
        + '无 tags/分类/weight，检索只能全文匹配；同样需过滤。',
      supportsWeight: false,
      notes: [
        '纯中文数组，每条仅 act + prompt 两个字段。',
        '繁体变体 prompts-zh-TW.json 存在（64,205 B），本期不内置。'
      ]
    }
  ];

  /* 用户自定义源模板：非内置，可增删改，走同一解析管线 */
  var CUSTOM_SOURCE_TEMPLATE = {
    id: '',
    name: '自定义源',
    kind: SOURCE_KIND.CUSTOM_JSON,
    origin: SOURCE_ORIGIN.CUSTOM,
    enabled: true,
    removable: true,
    lang: 'zh',
    url: '',
    ref: null,
    enabledFallback: false,
    homepage: '',
    licenseId: 'UNKNOWN',
    licenseNote: '用户自带源：许可由用户自行确认。',
    supportsWeight: false,
    fieldMap: {
      title: 'title',
      content: 'prompt',
      tags: 'tags',
      id: 'id',
      description: 'description',
      author: 'author'
    },
    /* 可选的“数组所在路径”，例如 'data.items'；空 = 顶层即数组 */
    listPath: '',
    notes: ['任意 JSON URL；默认按顶层数组解析，字段名可通过 fieldMap 映射。']
  };

  /* ---------------------------------------------------------------------------
   * 5) 许可注册表（含许可正文，供 UI 与分发物直接取用）
   *
   * CC0 正文：以 SPDX 标准文本为骨架；'f/prompts.chat' 的 LICENSE-CC0 本体经
   *   jsDelivr 返回 application/octet-stream，web_fetch 无法取回（REL-01 §3），
   *   故此处内置标准 CC0 1.0 声明段，并注明取自 SPDX。
   * MIT 正文：ENV-01 附录 A 的逐字正文（本机实测 HTTP 200）。
   * ------------------------------------------------------------------------ */
  /* MIT 正文按版权人参数化：**同一正文、不同版权人各自成条** —— 不得让两个不同版权人的
     源共用同一条署名（REL-01 §4.4 强制署名；评审 F-2）。 */
  function makeMitText(holderLine) {
    return [
      'MIT License',
      '',
      holderLine,
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction, including without limitation the rights',
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
      'copies of the Software, and to permit persons to whom the Software is',
      'furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all',
      'copies or substantial portions of the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
      'SOFTWARE.'
    ].join('\n');
  }
  var MIT_TEXT = makeMitText('Copyright (c) 2023 rockbenben');
  /* B2（rockbenben/ChatGPT-Shortcut）与 B3（PlexPt/awesome-chatgpt-prompts-zh）是**两个不同
     版权人**，因此各自一条 MIT 条目，正文同、版权行不同。 */
  var MIT_PLEXPT_TEXT = makeMitText('Copyright (c) 2025 plex');

  var CC0_TEXT = [
    'CC0 1.0 Universal (Public Domain Dedication)',
    '',
    'The person who associated a work with this deed has dedicated the work to the',
    'public domain by waiving all of his or her rights to the work worldwide under',
    'copyright law, including all related and neighboring rights, to the extent',
    'allowed by law.',
    '',
    'You can copy, modify, distribute and perform the work, even for commercial',
    'purposes, all without asking permission.',
    '',
    'Full legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',
    'SPDX identifier: CC0-1.0',
    '',
    '[本副本按 SPDX 标准 CC0-1.0 声明段内置。上游 LICENSE-CC0 本体经 jsDelivr 返回',
    ' application/octet-stream，本机 web_fetch 无法取回（见 REL-01 §3），故以 SPDX',
    ' 标准文本替代，不构成对上游条款的改写。]'
  ].join('\n');

  var LICENSES = {
    'CC0-1.0': {
      id: 'CC0-1.0',
      name: 'CC0 1.0 Universal（公共领域奉献）',
      spdx: 'CC0-1.0',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attributionRequired: false,
      attributionText: '数据来源：f/prompts.chat（原 awesome-chatgpt-prompts）',
      sourceUrl: 'https://github.com/f/prompts.chat',
      copyrightHolder: null,
      textSource: 'SPDX CC0-1.0 声明段（上游 LICENSE-CC0 本体经 jsDelivr 返回 octet-stream，无法取回）',
      text: CC0_TEXT,
      fullTextAvailable: true,
      /* 是否属于「必须署名」的强义务许可 */
      strongAttribution: false
    },
    MIT: {
      id: 'MIT',
      name: 'MIT License',
      spdx: 'MIT',
      url: 'https://opensource.org/license/mit',
      attributionRequired: true,
      attributionText: 'Copyright (c) 2023 rockbenben — MIT License；数据来源：rockbenben/ChatGPT-Shortcut',
      sourceUrl: 'https://github.com/rockbenben/ChatGPT-Shortcut',
      copyrightHolder: 'Copyright (c) 2023 rockbenben',
      textSource: 'ENV-01 附录 A（本机 web_fetch 实测 HTTP 200 的逐字正文）',
      text: MIT_TEXT,
      fullTextAvailable: true,
      strongAttribution: true
    },
    'MIT-plexpt': {
      id: 'MIT-plexpt',
      name: 'MIT License',
      spdx: 'MIT',
      url: 'https://opensource.org/license/mit',
      attributionRequired: true,
      attributionText: 'Copyright (c) 2025 plex — MIT License；数据来源：PlexPt/awesome-chatgpt-prompts-zh',
      sourceUrl: 'https://github.com/PlexPt/awesome-chatgpt-prompts-zh',
      copyrightHolder: 'Copyright (c) 2025 plex',
      textSource: '上游 LICENSE 逐字正文（本机 web_fetch 经 cdn.jsdelivr.net 镜像实测 HTTP 200）',
      text: MIT_PLEXPT_TEXT,
      fullTextAvailable: true,
      strongAttribution: true
    },
    UNKNOWN: {
      id: 'UNKNOWN',
      name: '许可未知（用户自带源）',
      spdx: null,
      url: '',
      attributionRequired: false,
      attributionText: '许可未知，请用户自行确认来源与授权',
      sourceUrl: '',
      copyrightHolder: null,
      textSource: '无',
      text: '许可未知。用户自定义源的许可由用户自行确认，本插件不对其做任何担保。',
      fullTextAvailable: false,
      strongAttribution: false
    }
  };

  /* ---------------------------------------------------------------------------
   * 6) 持久化键位与容量护栏
   *
   * 只用一个根键（版本化 + 迁移护栏集中在根），缓存独立成键以便单独淘汰。
   * ------------------------------------------------------------------------ */
  var STORAGE_KEYS = {
    STATE: 'dsh-prompt-market:state',        // 唯一权威状态根（含 schemaVersion）
    CACHE_PREFIX: 'dsh-prompt-market:cache:' // 每个源一个键
  };

  var SCHEMA_VERSION = 1;

  var LIMITS = {
    /* state 单次写入的最大序列化字节；超过则拒绝写入并回可展示错误 */
    STATE_MAX_BYTES: 2 * 1024 * 1024,
    /* 单个源缓存快照的最大序列化字节（超出则截断条目并标记 truncated） */
    CACHE_MAX_BYTES_PER_SOURCE: 900 * 1024,
    /* 全部源缓存的合计上限，超限按 fetchedAt 最旧者先淘汰 */
    CACHE_MAX_BYTES_TOTAL: 2 * 1024 * 1024,
    /* 远程响应体上限。
       ⚠️ 运行期实测修正（2026-10-06）：内置英文源 f/prompts.chat 的 prompts.csv
       响应体实际 **5769655 字节**，而原上限 4 MB 会把整包丢弃 ⇒ 该源**一条都读不出来**
       （用户界面显示「prompts-chat-csv E_PARSE 响应体实际 5769655 字节，超过上限 4194304 字节」）。
       原注释里「避开 8 MB 级文件」的假设由此被推翻：内置源本身就有 5.5 MB 级文件。
       现放宽到 12 MB，为上游继续增长留出余量；内存与解析开销经评估可接受。 */
    RESPONSE_MAX_BYTES: 12 * 1024 * 1024,
    /* 单条正文字符上限（防上游超长条目） */
    CONTENT_MAX_CHARS: 20000,
    /* 标题长度上限 */
    TITLE_MAX_CHARS: 300,
    /* 导入文件的字节上限 */
    IMPORT_MAX_BYTES: 5 * 1024 * 1024,
    /* 自建提示词条数上限 */
    CUSTOM_MAX_ITEMS: 5000,
    /* 收藏条数上限 */
    FAVORITES_MAX: 5000,
    /* 标签条数上限 */
    TAGS_MAX: 200
  };

  /* ---------------------------------------------------------------------------
   * 7) 网络默认参数（超时 / 重试 / 限流退避）
   * ------------------------------------------------------------------------ */
  var NET_DEFAULTS = {
    timeoutMs: 15000,
    retries: 2,             // 总尝试次数 = retries + 1 = 3
    backoffMs: 600,
    backoffFactor: 3,
    maxBackoffMs: 8000,
    /* 内存级 TTL：同一源在此窗口内不重复出网（缓存优先、减少配额消耗） */
    memoryTtlMs: 10 * 60 * 1000,
    /* 缓存被视为“新鲜”的时长；过期但仍可作为离线降级数据使用 */
    cacheFreshMs: 24 * 60 * 60 * 1000,
    /* 429 时的默认退避（上游未给 Retry-After 时用） */
    rateLimitBackoffMs: 60000,
    userAgent: 'dsh-prompt-market/0.1.0 (+local plugin; zero-backend)'
  };

  /* ---------------------------------------------------------------------------
   * 8) 内容过滤默认名单（可配置，默认开启）
   *
   * 依据 CONSTRAINTS-01 §B2 强制义务 ③ 与 REL-01 §2.5：中文库实测含
   * DAN 越狱（id:110「AI DAN（旧版/失效）」）与成人角色扮演（「涩涩女友」「好耶！魅魔！」）条目。
   * 规则用关键词 + 组合式正则，命中即过滤（默认动作 = 隐藏）。
   * ------------------------------------------------------------------------ */
  var FILTER_DEFAULT_RULES = [
    {
      id: 'jailbreak-dan',
      label: 'DAN / 越狱类',
      enabled: true,
      severity: 'high',
      /* 词边界匹配，避免误伤 "dance"/"danger" 等 */
      patterns: [
        '\\bDAN\\b',
        'Do\\s+Anything\\s+Now',
        '越狱',
        'jailbreak',
        '开发者模式\\s*[（(]?\\s*Developer\\s*Mode',
        'Developer\\s+Mode\\s*(已|被)?\\s*(启用|开启|激活)',
        '不受任何限制',
        '绕过\\s*(所有|任何)?\\s*(限制|规则|审查|安全)',
        'bypass\\s+(all\\s+)?(restrictions|rules|safety|guardrails)',
        'ignore\\s+(all\\s+)?(previous|prior)\\s+instructions',
        '忽略\\s*(之前|以上|所有)\\s*(的)?\\s*(指令|设定|规则)'
      ]
    },
    {
      id: 'adult-roleplay',
      label: '成人角色扮演',
      enabled: true,
      severity: 'high',
      patterns: [
        '涩涩',
        '魅魔',
        '调教',
        '情色',
        '色情',
        '妹控',
        '百合\\s*女友',
        'NSFW',
        'nsfw',
        '成人角色扮演',
        'erotic\\s+roleplay',
        'sexual\\s+roleplay',
        'sexual\\s+content',
        'explicit\\s+sexual'
      ]
    },
    {
      id: 'explicit-vulgar',
      label: '露骨/低俗',
      enabled: true,
      severity: 'medium',
      patterns: [
        '裸体',
        '性爱',
        '做爱',
        '约炮',
        '自慰',
        'porn',
        'pornographic',
        'nude',
        'orgasm'
      ]
    },
    {
      id: 'violence-extreme',
      label: '极端暴力',
      enabled: true,
      severity: 'medium',
      patterns: [
        '虐杀',
        '肢解',
        '自杀\\s*(方法|教程)',
        'how\\s+to\\s+kill\\s+(a\\s+)?(person|human)',
        '制造\\s*(炸弹|爆炸物)',
        'build\\s+a\\s+bomb'
      ]
    },
    {
      id: 'politics-sensitive',
      label: '涉政敏感',
      enabled: true,
      severity: 'high',
      patterns: [
        '颠覆国家政权',
        '煽动颠覆',
        '分裂国家',
        '反华',
        '辱华'
      ]
    },
    {
      id: 'custom-blocklist',
      label: '用户自定义屏蔽词',
      enabled: true,
      severity: 'medium',
      /* 由设置项 filterCustomTerms 填充（按行分，每行一个词，按子串匹配） */
      custom: true,
      patterns: []
    }
  ];

  var FILTER_DEFAULT_SETTINGS = {
    enabled: true,              // 默认开启（硬需求）
    actionMode: 'hide',         // 'hide' = 直接剔除；'mark' = 保留但标 filtered
    customTerms: [],
    extraRuleIds: [],
    disabledRuleIds: []
  };

  /* ---------------------------------------------------------------------------
   * 9) 错误分类（全数据层统一的 code，UI 可直接 switch）
   * ------------------------------------------------------------------------ */
  var ERROR_CODES = {
    NETWORK: 'E_NETWORK',
    TIMEOUT: 'E_TIMEOUT',
    HTTP: 'E_HTTP',
    RATE_LIMIT: 'E_RATE_LIMIT',
    PARSE: 'E_PARSE',
    SCHEMA: 'E_SCHEMA',
    STORAGE: 'E_STORAGE',
    QUOTA: 'E_QUOTA',
    BAD_INPUT: 'E_BAD_INPUT',
    NOT_FOUND: 'E_NOT_FOUND',
    UNSUPPORTED: 'E_UNSUPPORTED'
  };

  /* ---------------------------------------------------------------------------
   * 10) 对外冻结
   * ------------------------------------------------------------------------ */
  core.constants = {
    APP_ID: APP_ID,
    DATA_API_MAJOR: DATA_API_MAJOR,
    SOURCE_KIND: SOURCE_KIND,
    SOURCE_ORIGIN: SOURCE_ORIGIN,
    ITEM_FIELDS: ITEM_FIELDS,
    CDN: CDN,
    BUILTIN_SOURCES: BUILTIN_SOURCES,
    CUSTOM_SOURCE_TEMPLATE: CUSTOM_SOURCE_TEMPLATE,
    LICENSES: LICENSES,
    STORAGE_KEYS: STORAGE_KEYS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    LIMITS: LIMITS,
    NET_DEFAULTS: NET_DEFAULTS,
    FILTER_DEFAULT_RULES: FILTER_DEFAULT_RULES,
    FILTER_DEFAULT_SETTINGS: FILTER_DEFAULT_SETTINGS,
    ERROR_CODES: ERROR_CODES
  };
})(__pmCore);
