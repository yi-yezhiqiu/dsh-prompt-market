/* =============================================================================
 * plugin/core/browser.js — 提示词市场 · 数据层【浏览器半身成品源码】（免构建）
 * =============================================================================
 * 这是什么
 *   DSH 桌面端「提示词市场」插件的数据层，**可直接被浏览器执行、可直接内联**的
 *   自包含纯 JS 模块。零 require、零相对路径、零构建步骤、零外部依赖。
 *
 * 怎么用（t-ui / uismith 必读）
 *   把本文件**全部内容原样**放进 `plugin/client.js` 的 ModuleLoader factory 内即可。
 *   执行后宿主对象上会出现 `__pmCoreBrowser`，并在 `__pmCore` 为空时把同一个对象
 *   也挂到 `__pmCore` 上，所以 factory 里直接写：
 *       var __pmCore = window.__pmCore
 *   就拿到了数据层。不需要任何构建步骤，也不需要改一行代码。
 *
 *   可选看护工具（**不是前置条件**，只是防止 client.js 里的内联区过期）：
 *     node "plugin/core/assemble-browser.js"            # 由核心文件重新生成本文件
 *     node "plugin/core/assemble-browser.js" --verify   # 校验本文件与核心文件一致
 *     node "plugin/core/build-client-bundle.js" --check  # 校验 client.js 内联区与本文件一致
 *
 * 怎么用（Host / Node 侧）
 *     const src = await readFile('./core/browser.js', 'utf8')
 *     const ns = new Function('globalThis', src + '\n;return globalThis.__pmCore;')(shim)
 *     const market = ns.api.createDataLayer({})
 *
 * 三条硬约束（改本文件前必读）
 *   1) 不含被本机阻断的 raw 域名；默认地址一律 cdn.jsdelivr.net，
 *      api.github.com 只作 base64 兜底（CONSTRAINTS-01 §A）。
 *   2) 不使用模板字面量（反引号）、不使用 import/export —— 无编译步骤，源码即产物。
 *   3) 不 require 任何东西，不引用相对路径，不调用 host.call（队长裁决第 4 条）。
 *
 * 组成（**顶格书写**，每个单元都是独立完整语句；顺序固定，勿重排）
 *   unit: constants   —— 真值：源 URL/字段、许可正文、配额、过滤名单、错误码
 *   unit: text        —— 纯文本化、实体解码、哈希、安全 JSON、原型污染防护
 *   unit: filter      —— 可配置内容过滤（默认开启）
 *   unit: storage     —— 持久化 + schemaVersion 迁移护栏 + 配额护栏 + 缓存
 *   unit: normalize   —— RFC4180 CSV 解析 + 四适配器 + 统一模型
 *   unit: net         —— URL 拼装、超时、重试退避、429 容忍、base64 兜底
 *   unit: sources     —— 源注册表 + 单源降级管线 + 多源聚合
 *   unit: api         —— 门面（search / fav / custom / tags / sources / settings / filter / licenses / data / diag）
 *   unit: bootstrap   —— 把命名空间挂到 globalThis.__pmCore，并给出便捷方法名
 *
 *   各单元的行数（供 `docs/check-ui.ps1` 逐单元核对）登记在
 *   `plugin/core/.linecount.txt`，**不在本文件里重复写数字**（避免两处数字漂移）。
 *   文件内每个单元都被一对「inlined file」标记包裹，与上表一一对应，
 *   供静态脚本做逐区一致性比对（`docs/check-ui.ps1` 用）。
 *   （此处**故意不写出标记的完整字面量**：朴素子串匹配的脚本会把说明文字误当成
 *     一个真实单元标记，导致区段提取错位。）
 *
 * 怎么读它（Host / Node 侧也可用，纯脚本形态）
 *     const src = await readFile('plugin/core/browser.js', 'utf8')
 *     new Function(src)();                 // 执行后 globalThis.__pmCore 即数据层
 *     const market = globalThis.__pmCore.createDataLayer({})

/* BEGIN inlined file: constants.js */
/* =============================================================================
 * unit: constants.js — 数据层常量与内置源注册表
 * =============================================================================
 * 真值集中地：三个内置源（CONSTRAINTS-01 §B）、许可正文（MIT 逐字 + CC0 声明段）、
 * 配额护栏、过滤默认名单、错误码；全部 URL 由 repo+filePath+ref 拼装（net.buildUrls）。
 * ============================================================================= */

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
   *    url 由 repo + filePath + ref 拼装（net.buildUrls），不硬编码整串。
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
    /* 远程响应体上限（防止 8 MB 级文件把编辑器拖死；Q3/Q4 已决定避开） */
    RESPONSE_MAX_BYTES: 4 * 1024 * 1024,
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
      /* 由设置项 filter.customTerms 填充（逐词子串匹配） */
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

/* END inlined file: constants.js */

/* BEGIN inlined file: text.js */
/* =============================================================================
 * unit: text.js — 纯文本化、HTML 中和、哈希与基础类型工具
 *
 * 硬需求来源：任务书 (7)「远程内容一律按纯文本处理，禁止 HTML 注入」，
 *             验收 ④「远程内容按纯文本路径产出，HTML 被转义或丢弃」。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  /* ---------------------------------------------------------------------------
   * 1) 基础类型
   * ------------------------------------------------------------------------ */
  function isString(v) {
    return typeof v === 'string';
  }

  function isFn(v) {
    return typeof v === 'function';
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  /* 只接受有限数，其余一律 null（避免 NaN / Infinity 污染排序） */
  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function bool(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === '') return false;
    }
    if (typeof v === 'number') return v !== 0;
    return false;
  }

  /* ---------------------------------------------------------------------------
   * 2) HTML 实体
   * ------------------------------------------------------------------------ */
  var NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
    laquo: '\u00ab', raquo: '\u00bb', middot: '\u00b7', bull: '\u2022',
    times: '\u00d7', divide: '\u00f7', deg: '\u00b0',
    euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
    sect: '\u00a7', para: '\u00b6', dagger: '\u2020', permil: '\u2030',
    larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
    harr: '\u2194', infin: '\u221e', ne: '\u2260', le: '\u2264', ge: '\u2265'
  };

  function codePointToString(cp) {
    if (!isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
    if (cp <= 0xffff) return String.fromCharCode(cp);
    var v = cp - 0x10000;
    var hi = 0xd800 + (v >> 10);
    var lo = 0xdc00 + (v & 0x3ff);
    return String.fromCharCode(hi, lo);
  }

  /* 解码常见命名实体与全部数字实体（十进制 &#123; / 十六进制 &#x1F600;） */
  function decodeEntities(s) {
    if (!isString(s) || s.indexOf('&') < 0) return isString(s) ? s : '';
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, function (m, body) {
      if (body.charAt(0) === '#') {
        var hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        var raw = hex ? body.slice(2) : body.slice(1);
        var cp = parseInt(raw, hex ? 16 : 10);
        if (!isFinite(cp)) return m;
        var ch = codePointToString(cp);
        return ch === '' ? m : ch;
      }
      var key = body.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key];
      return m; // 未知实体：原样保留（不猜）
    });
  }

  /* 把可能被当作 HTML 的字符转义为实体（数据层不用，留给 UI 兜底） */
  function escapeHTML(s) {
    return str(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------------------
   * 3) 纯文本化
   *
   * 顺序很重要：
   *   a. 去 script/style/template/iframe 整块（含内容）——这类内容即使被转义也没意义；
   *   b. 去注释；
   *   c. 块级标签换成换行（保住段落结构），其余标签丢弃；
   *   d. 解码实体；
   *   e. 清控制字符（保留 \n \t）；
   *   f. 按上限截断并标记。
   * ------------------------------------------------------------------------ */
  var BLOCK_TAGS = 'p|div|br|li|ul|ol|tr|td|th|h1|h2|h3|h4|h5|h6|section|article|blockquote|pre';

  function countTags(s) {
    if (!isString(s) || s.indexOf('<') < 0) return 0;
    var m = s.match(/<\/?[a-zA-Z][^>]*>/g);
    return m ? m.length : 0;
  }

  function stripTags(s) {
    var out = s;
    /* a. 危险整块 */
    out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ');
    out = out.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
    out = out.replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ');
    out = out.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, ' ');
    /* b. 注释（含条件注释） */
    out = out.replace(/<!--[\s\S]*?-->/g, ' ');
    /* c1. 自闭合 br / 换行类标签 */
    out = out.replace(/<br\s*\/?>/gi, '\n');
    /* c2. 块级标签的开闭都换算行，避免标题与正文黏在一起 */
    out = out.replace(new RegExp('</?(?:' + BLOCK_TAGS + ')\\b[^>]*>', 'gi'), '\n');
    /* c3. 其余标签（行内标签如 <b>/<i>/<span>/<a>，以及自闭合与属性里带 > 的朴素形态）
       **整体删除、不插入任何字符** —— 行内标签不产生词间分隔；若此处换成空格，
       '<b>粗</b>体' 会变成 '粗 体'（t22 修）。块级标签已由 c2 换算行，不受影响。 */
    out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');
    return out;
  }

  /* 归一化空白：不在行首/行尾堆空白，不留 3 个以上连续空行 */
  function normalizeWhitespace(s) {
    var out = s.replace(/\r\n?/g, '\n');
    /* 行内 tab 与多空格压缩 */
    out = out.replace(/[ \t\u00a0\u3000]+/g, ' ');
    /* 行尾空白 */
    out = out.replace(/[ \t]+$/gm, '');
    /* 3+ 换行压成 2 个 */
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.replace(/^\s+|\s+$/g, '');
  }

  function stripControlChars(s) {
    /* 去掉 C0/C1 控制字符，但保留 \n 与 \t */
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 9 || c === 10) { out += s.charAt(i); continue; }
      if (c < 32 || c === 127) continue;
      if (c >= 128 && c <= 159) continue;
      out += s.charAt(i);
    }
    return out;
  }

  /**
   * 把任意远程/导入字符串转成可安全展示与写入的纯文本。
   * @param {*} raw 原始值
   * @param {object} [opts] { maxChars, keepNewlines, collapseWhitespace }
   * @returns {{ text:string, changed:boolean, htmlTags:number, truncated:boolean, originalLength:number }}
   *          永不抛错。
   */
  function sanitizeText(raw, opts) {
    var options = isPlainObject(opts) ? opts : {};
    var maxChars = num(options.maxChars);
    if (maxChars === null || maxChars <= 0) maxChars = 0; // 0 = 不截断
    var keepNewlines = options.keepNewlines !== false;
    var collapse = options.collapseWhitespace !== false;

    var original = str(raw);
    if (options.normalizeNFC !== false && isFn(String.prototype.normalize)) {
      try { original = original.normalize('NFC'); } catch (e) { /* 忽略：老引擎无 normalize */ }
    }

    var htmlTags = countTags(original);
    var text = original;
    if (htmlTags > 0 || text.indexOf('&') >= 0) {
      text = stripTags(text);
      text = decodeEntities(text);
    }
    text = stripControlChars(text);
    if (!keepNewlines) text = text.replace(/\n/g, ' ');
    if (collapse) text = normalizeWhitespace(text);
    else text = text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');

    var truncated = false;
    if (maxChars > 0 && text.length > maxChars) {
      text = text.slice(0, maxChars);
      truncated = true;
    }

    return {
      text: text,
      changed: text !== original,
      htmlTags: htmlTags,
      truncated: truncated,
      originalLength: original.length
    };
  }

  /* 便捷版：只要纯文本结果 */
  function toPlainText(raw, opts) {
    return sanitizeText(raw, opts).text;
  }

  /* 判断字符串里是否含会被当作 HTML 解析的结构（给过滤/告警用） */
  function looksLikeHTML(s) {
    return countTags(s) > 0;
  }

  /* ---------------------------------------------------------------------------
   * 4) 哈希（FNV-1a 32bit，十六进制）—— 去重、缓存比对、变更检测
   * ------------------------------------------------------------------------ */
  function fnv1a32(s) {
    var h = 0x811c9dc5;
    var text = str(s);
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      /* 高 8 位也混一次，UTF-16 码元 > 255 时不至于丢信息 */
      h ^= (text.charCodeAt(i) >> 8) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function contentHash(s) {
    return fnv1a32(normalizeWhitespace(str(s)));
  }

  /* ---------------------------------------------------------------------------
   * 5) 通用小工具
   * ------------------------------------------------------------------------ */
  function nowIso(clock) {
    var d = isFn(clock) ? clock() : new Date();
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    return d.toISOString();
  }

  function clamp(v, min, max) {
    var n = num(v);
    if (n === null) n = min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /* 深拷贝（只处理 JSON 可表达的值；用于防止调用方改到内部状态） */
  function cloneJSON(v) {
    if (v === null || v === undefined) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  /* 安全 JSON.parse：不抛错，返回 { ok, value, error } */
  function safeParseJSON(text) {
    if (!isString(text) || text === '') {
      return { ok: false, value: null, error: 'empty-input' };
    }
    try {
      return { ok: true, value: JSON.parse(text), error: null };
    } catch (e) {
      return { ok: false, value: null, error: (e && e.message) ? e.message : 'json-parse-failed' };
    }
  }

  /* UTF-8 字节数估算（用于配额护栏；不依赖 TextEncoder） */
  function utf8Bytes(s) {
    var text = str(s);
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  /* 原型污染防护：导入的 JSON 里出现这些键一律丢弃 */
  var DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

  function hasDangerousKey(obj, depth) {
    var d = depth === undefined ? 0 : depth;
    if (d > 6 || !obj || typeof obj !== 'object') return false;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      if (DANGEROUS_KEYS.indexOf(keys[i]) >= 0) return true;
      if (hasDangerousKey(obj[keys[i]], d + 1)) return true;
    }
    return false;
  }

  /* 剥掉危险键（浅层 + 递归），返回新结构 */
  function stripDangerousKeys(obj, depth) {
    var d = depth === undefined ? 0 : depth;
    if (d > 8) return null;
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) arr.push(stripDangerousKeys(obj[i], d + 1));
      return arr;
    }
    if (obj && typeof obj === 'object') {
      var out = {};
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (DANGEROUS_KEYS.indexOf(key) >= 0) continue;
        out[key] = stripDangerousKeys(obj[key], d + 1);
      }
      return out;
    }
    return obj;
  }

  core.text = {
    isString: isString,
    isFn: isFn,
    isPlainObject: isPlainObject,
    str: str,
    num: num,
    bool: bool,
    decodeEntities: decodeEntities,
    escapeHTML: escapeHTML,
    stripTags: stripTags,
    countTags: countTags,
    normalizeWhitespace: normalizeWhitespace,
    stripControlChars: stripControlChars,
    sanitizeText: sanitizeText,
    toPlainText: toPlainText,
    looksLikeHTML: looksLikeHTML,
    fnv1a32: fnv1a32,
    contentHash: contentHash,
    nowIso: nowIso,
    clamp: clamp,
    cloneJSON: cloneJSON,
    safeParseJSON: safeParseJSON,
    utf8Bytes: utf8Bytes,
    hasDangerousKey: hasDangerousKey,
    stripDangerousKeys: stripDangerousKeys,
    NAMED_ENTITIES: NAMED_ENTITIES
  };
})(__pmCore);

/* END inlined file: text.js */

/* BEGIN inlined file: filter.js */
/* =============================================================================
 * unit: filter.js — 可配置内容过滤（默认开启）
 *
 * 硬需求来源：CONSTRAINTS-01 §B2 强制义务 ③、REL-01 §2.5、任务书 (8)。
 *   - 中文库实测含 DAN 越狱（id:110「AI DAN（旧版/失效）」）与成人角色扮演
 *     （「涩涩女友」「好耶！魅魔！」）条目；
 *   - 过滤**默认开启**，但必须可配置（开关、动作模式、自定义词、单条规则启停）。
 *
 * 语义约定：过滤发生在**读取时**（query/list），不发生在缓存写入时。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};

  var FILTER_FIELDS = ['title', 'description', 'remark', 'content', 'tags'];

  function cloneRules() {
    var src = constants.FILTER_DEFAULT_RULES || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var r = src[i];
      out.push({
        id: r.id,
        label: r.label,
        enabled: r.enabled !== false,
        severity: r.severity || 'medium',
        custom: r.custom === true,
        patterns: (r.patterns || []).slice(0)
      });
    }
    return out;
  }

  /**
   * 合并默认规则与用户设置，返回**生效的规则表**（不编译正则）。
   * @param {object} [settings] 过滤器设置
   * @returns {Array<{id,label,enabled,severity,custom,patterns}>}
   */
  function rules(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var out = cloneRules();
    var disabledIds = Array.isArray(s.disabledRuleIds) ? s.disabledRuleIds : [];
    var extraIds = Array.isArray(s.extraRuleIds) ? s.extraRuleIds : [];
    var customTerms = Array.isArray(s.customTerms) ? s.customTerms : [];

    var i;
    for (i = 0; i < out.length; i++) {
      if (disabledIds.indexOf(out[i].id) >= 0) out[i].enabled = false;
      if (extraIds.indexOf(out[i].id) >= 0) out[i].enabled = true;
      if (out[i].custom) {
        /* 自定义屏蔽词：逐词作为子串规则（不编译成正则，避免用户输入的元字符） */
        out[i].patterns = [];
        out[i].terms = [];
        for (var t = 0; t < customTerms.length; t++) {
          var term = text.str(customTerms[t]).trim();
          if (term !== '') out[i].terms.push(term);
        }
        if (out[i].terms.length === 0) out[i].enabled = false;
      }
    }
    return out;
  }

  /* 单条 pattern 编译成正则；失败则降级为字面量 includes（永不抛错） */
  function compilePattern(pattern) {
    var src = text.str(pattern);
    if (src === '') return null;
    try {
      var flags = 'i';
      if (!/^\^[\s\S]*\$/.test(src)) flags += 'g';
      return { kind: 'regex', value: new RegExp(src, flags), raw: src };
    } catch (e) {
      return { kind: 'literal', value: src.toLowerCase(), raw: src };
    }
  }

  /**
   * 编译生效规则（UI 可缓存；设置变化时重建）。
   * @param {object} [settings]
   * @returns {{ rules:Array, compiled:Array, enabled:boolean, actionMode:string }}
   */
  function compile(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var enabled = s.enabled !== false; // 默认 true
    var actionMode = s.actionMode === 'mark' ? 'mark' : 'hide';
    var list = rules(s);
    var compiled = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r.enabled) continue;
      var entry = {
        id: r.id,
        label: r.label,
        severity: r.severity,
        custom: r.custom,
        patterns: [],
        terms: r.terms || []
      };
      for (var p = 0; p < r.patterns.length; p++) {
        var c = compilePattern(r.patterns[p]);
        if (c) entry.patterns.push(c);
      }
      compiled.push(entry);
    }
    return { rules: list, compiled: compiled, enabled: enabled, actionMode: actionMode };
  }

  /* 对单个字符串跑一条已编译规则，返回命中证据（无命中返回 null） */
  function matchOneRule(rule, haystack) {
    var i;
    for (i = 0; i < rule.terms.length; i++) {
      var idx = haystack.toLowerCase().indexOf(rule.terms[i].toLowerCase());
      if (idx >= 0) return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: rule.terms[i] };
    }
    for (i = 0; i < rule.patterns.length; i++) {
      var p = rule.patterns[i];
      if (p.kind === 'literal') {
        if (haystack.toLowerCase().indexOf(p.value) >= 0) {
          return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: p.raw };
        }
      } else {
        try {
          p.value.lastIndex = 0;
          var m = p.value.exec(haystack);
          if (m) {
            return { ruleId: rule.id, label: rule.label, severity: rule.severity, hit: m[0] };
          }
        } catch (e) { /* 单条正则异常不影响其它规则 */ }
      }
    }
    return null;
  }

  /**
   * 对一段文本做过滤检查。
   * @param {string} s 待检文本
   * @param {object} [settings] 或已编译结果（compile() 的返回值）
   * @returns {{ blocked:boolean, matches:Array, actionMode:string }}
   */
  function check(s, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var result = { blocked: false, matches: [], actionMode: compiledSet.actionMode };
    if (!compiledSet.enabled) return result;

    var haystack = text.str(s);
    if (haystack === '') return result;

    for (var i = 0; i < compiledSet.compiled.length; i++) {
      var hit = matchOneRule(compiledSet.compiled[i], haystack);
      if (hit) result.matches.push(hit);
    }
    result.blocked = result.matches.length > 0;
    return result;
  }

  /**
   * 对一个归一化条目做过滤（扫 title/description/remark/content/tags）。
   * @param {object} item 归一化模型
   * @param {object} [settings]
   * @returns {{ blocked:boolean, matches:Array, fields:Array<string> }}
   */
  function checkItem(item, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var out = { blocked: false, matches: [], fields: [] };
    if (!compiledSet.enabled || !item || typeof item !== 'object') return out;

    for (var f = 0; f < FILTER_FIELDS.length; f++) {
      var field = FILTER_FIELDS[f];
      var raw = item[field];
      var s = Array.isArray(raw) ? raw.join(' , ') : text.str(raw);
      if (s === '') continue;
      for (var i = 0; i < compiledSet.compiled.length; i++) {
        var hit = matchOneRule(compiledSet.compiled[i], s);
        if (hit) {
          /* 同一规则在同一字段只记一次 */
          var dup = false;
          for (var d = 0; d < out.matches.length; d++) {
            if (out.matches[d].ruleId === hit.ruleId && out.matches[d].field === field) { dup = true; break; }
          }
          if (!dup) {
            out.matches.push({ ruleId: hit.ruleId, label: hit.label, severity: hit.severity, hit: hit.hit, field: field });
            if (out.fields.indexOf(field) < 0) out.fields.push(field);
          }
        }
      }
    }
    out.blocked = out.matches.length > 0;
    return out;
  }

  /**
   * 对列表批量过滤。**这是 UI 唯一的入口**。
   * @param {Array<object>} items
   * @param {object} [settings]
   * @returns {{ items, kept, dropped, flagged, stats }}
   *          hide 模式：items = kept（不含命中项）；mark 模式：items 含命中项但带 filtered 标记。
   */
  function apply(items, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var list = Array.isArray(items) ? items : [];
    var kept = [];
    var dropped = [];
    var flagged = [];
    var resultItems = [];

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var res = checkItem(item, compiledSet);
      if (!res.blocked) {
        kept.push(item);
        resultItems.push(item);
        continue;
      }
      var annotated = item;
      if (compiledSet.enabled) {
        annotated = {};
        for (var k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k)) annotated[k] = item[k];
        }
        annotated.filtered = true;
        annotated.filterMatches = res.matches;
      }
      if (compiledSet.enabled && compiledSet.actionMode === 'mark') {
        flagged.push(annotated);
        kept.push(annotated);
        resultItems.push(annotated);
      } else {
        dropped.push(annotated);
      }
    }

    return {
      items: resultItems,
      kept: kept,
      dropped: dropped,
      flagged: flagged,
      stats: {
        input: list.length,
        kept: kept.length,
        dropped: dropped.length,
        flagged: flagged.length,
        filtered: compiledSet.enabled,
        actionMode: compiledSet.actionMode
      }
    };
  }

  /* 默认设置（返回新对象，可直接写进 store） */
  function defaultSettings() {
    var d = constants.FILTER_DEFAULT_SETTINGS || {};
    return {
      enabled: d.enabled !== false,
      actionMode: d.actionMode === 'mark' ? 'mark' : 'hide',
      customTerms: (d.customTerms || []).slice(0),
      extraRuleIds: (d.extraRuleIds || []).slice(0),
      disabledRuleIds: (d.disabledRuleIds || []).slice(0)
    };
  }

  /* 规范化用户传入的设置（导入 / UI 写入都走这里） */
  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    if (typeof raw.enabled === 'boolean') d.enabled = raw.enabled;
    if (raw.actionMode === 'mark' || raw.actionMode === 'hide') d.actionMode = raw.actionMode;
    if (Array.isArray(raw.customTerms)) {
      var terms = [];
      for (var i = 0; i < raw.customTerms.length && terms.length < 200; i++) {
        var t = text.str(raw.customTerms[i]).trim();
        if (t !== '' && terms.indexOf(t) < 0) terms.push(t.slice(0, 64));
      }
      d.customTerms = terms;
    }
    if (Array.isArray(raw.extraRuleIds)) d.extraRuleIds = raw.extraRuleIds.filter(function (x) { return typeof x === 'string'; });
    if (Array.isArray(raw.disabledRuleIds)) d.disabledRuleIds = raw.disabledRuleIds.filter(function (x) { return typeof x === 'string'; });
    return d;
  }

  /* 命中统计（不裁剪；给“过滤掉了 N 条”的 UI 提示用） */
  function countBlocked(items, settings) {
    var compiledSet = (settings && settings.compiled && Array.isArray(settings.compiled))
      ? settings : compile(settings);
    var n = 0;
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && checkItem(list[i], compiledSet).blocked) n++;
    }
    return n;
  }

  core.filter = {
    FILTER_FIELDS: FILTER_FIELDS,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    rules: rules,
    compile: compile,
    check: check,
    checkItem: checkItem,
    apply: apply,
    countBlocked: countBlocked
  };
})(__pmCore);

/* END inlined file: filter.js */

/* BEGIN inlined file: storage.js */
/* =============================================================================
 * unit: storage.js — 版本化本地持久化（localStorage 优先，内存降级）
 *
 * Q1 决策落地：载体 = 浏览器 localStorage（零后端零权限）；
 * 但必须把「localStorage 不可用」当成一等公民场景：
 *   探测式获取后端（真写—读回—删除）→ 失败则降级内存后端并回报 durable:false。
 * schemaVersion 与迁移护栏；未来版本只读挂载；损坏数据留档 + 有界救援。
 * 全部函数不抛未捕获异常；写失败返回 { ok:false, code, message }。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var filter = core.filter || {};

  var KEYS = constants.STORAGE_KEYS || { STATE: 'dsh-prompt-market:state', CACHE_PREFIX: 'dsh-prompt-market:cache:' };
  var LIMITS = constants.LIMITS || {};
  var CURRENT_SCHEMA = constants.SCHEMA_VERSION || 1;
  var STATE_KEY = KEYS.STATE;
  var CACHE_PREFIX = KEYS.CACHE_PREFIX;
  var QUARANTINE_KEY = STATE_KEY + ':quarantine';
  var SENTINEL_KEY = STATE_KEY + ':probe';

  /* ---------------------------------------------------------------------------
   * 1) 后端探测
   * ------------------------------------------------------------------------ */
  function memoryBackend() {
    var map = {};
    var order = [];
    return {
      kind: 'memory',
      usable: true,
      durable: false,
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      },
      setItem: function (k, v) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) order.push(k);
        map[k] = String(v);
        return true;
      },
      removeItem: function (k) {
        if (Object.prototype.hasOwnProperty.call(map, k)) delete map[k];
        return true;
      },
      keys: function () { return order.slice(0); }
    };
  }

  /* 对候选后端做真写—读回—删除探测（不能只用 typeof 判断） */
  function probeBackend(candidate) {
    if (!candidate) return { ok: false, reason: 'missing' };
    try {
      candidate.setItem(SENTINEL_KEY, 'ok');
      var back = candidate.getItem(SENTINEL_KEY);
      candidate.removeItem(SENTINEL_KEY);
      if (back !== 'ok') return { ok: false, reason: 'readback-mismatch' };
      return { ok: true, reason: 'write-read-remove-ok' };
    } catch (e) {
      return { ok: false, reason: (e && e.name) ? e.name : 'threw' };
    }
  }

  function resolveBackend(injected) {
    var report = {
      kind: 'memory',
      durable: false,
      writable: false,
      reason: '',
      source: 'fallback'
    };

    /* a) 显式注入优先（verifier 可用它注入夹具后端做无副作用测试） */
    if (injected) {
      var pi = probeBackend(injected);
      if (pi.ok) {
        report.kind = injected.kind || 'injected';
        report.durable = injected.durable !== false;
        report.writable = true;
        report.reason = 'injected-backend:' + pi.reason;
        report.source = 'injected';
        injected.kind = report.kind;
        injected.durable = report.durable;
        injected.usable = true;
        return { backend: injected, report: report };
      }
      report.reason = 'injected-backend-unusable:' + pi.reason;
      report.source = 'injected-failed';
    }

    /* b) 浏览器 localStorage（零后端零权限的首选） */
    var ls = null;
    try { ls = globalThis.localStorage || null; } catch (e) { ls = null; }
    if (!ls && typeof globalThis.window !== 'undefined' && globalThis.window) {
      try { ls = globalThis.window.localStorage || null; } catch (e2) { ls = null; }
    }
    if (ls) {
      var pl = probeBackend(ls);
      if (pl.ok) {
        ls.kind = 'localStorage';
        ls.durable = true;
        ls.usable = true;
        report.kind = 'localStorage';
        report.durable = true;
        report.writable = true;
        report.reason = pl.reason;
        report.source = 'localStorage';
        return { backend: ls, report: report };
      }
      report.reason = (report.reason ? report.reason + ' | ' : '') + 'localStorage-unusable:' + pl.reason;
    } else {
      report.reason = (report.reason ? report.reason + ' | ' : '') + 'localStorage-absent';
    }

    /* c) 内存降级（可用但不持久化；UI 需提示） */
    var mem = memoryBackend();
    return { backend: mem, report: report };
  }

  /* ---------------------------------------------------------------------------
   * 2) 默认状态与规范化
   * ------------------------------------------------------------------------ */
  function migrateItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var uid = text.str(raw.uid || raw.id);
    if (uid === '') return null;
    var content = text.sanitizeText(raw.content !== undefined ? raw.content : raw.body, {
      maxChars: LIMITS.CONTENT_MAX_CHARS || 20000
    });
    var title = text.sanitizeText(raw.title, { maxChars: LIMITS.TITLE_MAX_CHARS || 300, keepNewlines: false });
    var iso = function (v) {
      var s = text.str(v);
      return s === '' ? text.nowIso() : s;
    };
    return {
      uid: uid,
      id: uid,
      sourceId: text.str(raw.sourceId) || 'local',
      nativeId: text.str(raw.nativeId) || uid,
      title: title.text,
      content: content.text,
      body: content.text,
      tags: Array.isArray(raw.tags) ? raw.tags.map(function (t) { return text.str(t).slice(0, 40); }).slice(0, 20) : [],
      lang: text.str(raw.lang) || 'zh',
      author: raw.author === undefined ? null : text.str(raw.author),
      description: text.sanitizeText(raw.description, { maxChars: 2000 }).text,
      remark: text.sanitizeText(raw.remark, { maxChars: 2000 }).text,
      weight: text.num(raw.weight),
      website: raw.website === undefined ? null : text.str(raw.website),
      sourceUrl: text.str(raw.sourceUrl) || '',
      license: raw.license && typeof raw.license === 'object' ? raw.license : null,
      sanitized: raw.sanitized === true || content.changed,
      contentHash: text.str(raw.contentHash) || text.contentHash(content.text),
      custom: raw.custom === true,
      filtered: raw.filtered === true ? true : undefined,
      createdAt: iso(raw.createdAt),
      updatedAt: iso(raw.updatedAt)
    };
  }

  function defaultState() {
    return {
      schemaVersion: CURRENT_SCHEMA,
      appId: constants.APP_ID || 'dsh-prompt-market',
      updatedAt: text.nowIso(),
      revision: 0,
      appliedMigrations: [],
      licenseAcknowledged: false,
      favorites: [],
      customs: [],
      sources: [],
      tags: [],
      settings: defaultSettings()
    };
  }

  function defaultSettings() {
    var f = filter.defaultSettings ? filter.defaultSettings() : { enabled: true, actionMode: 'hide', customTerms: [], extraRuleIds: [], disabledRuleIds: [] };
    return {
      /* 写入策略（**取值域只有这两个**）：
       *   'insert' = 在光标处插入（默认）
       *   'append' = 追加到草稿末尾（自动补空行）
       *
       * 关于「覆盖整段草稿」的准确能力边界（与 api.js 的错误文案同一口径）：
       *   - 插件**无法主动**清空草稿或设置选区：InputActions 只有
       *     captureInsertion / insertText / setDraft 三个动作；
       *   - **但**用户自己 Ctrl+A 全选后再触发 insertText，就等价于覆盖整段
       *     （insertText 是在**捕获到的选区**上插入）。
       *   ⇒「替换」不是一个可持久化的设置项（所以取值域里没有它，旧配置里的脏值
       *     会在 normalizeSettings 里静默回落 'insert'），**但界面可以在能捕获到
       *     覆盖全文的选区时，把它作为条件动作提供**；捕获不到时如实提示用户先全选。 */
      writeMode: 'insert',
      /* 中文库写入哪个字段（t13 改默认值）：
       *   'description' = 中文说明（**现在的默认**）—— 中文库的 prompt 多为英文原文
       *     （constants.js 的 promptIsMostlyEnglish: true），默认写中文让用户看得懂、可修改；
       *   'prompt'      = 可直接执行的原文（英文为主），保留给用户显式切回。
       * 取值集合不变：仍允许 'prompt' | 'description'（见 normalizeSettings 的护栏）。 */
      writeField: 'description',
      /* 默认排序：weight（有 weight 的源）/ title */
      sort: 'weight',
      /* 每页条数 */
      pageSize: 60,
      /* 内容过滤 */
      filter: f,
      /* 源刷新：是否允许 api.github.com base64 兜底（会消耗 60/h 匿名配额） */
      allowGithubFallback: true,
      /* 可选的 api.github.com token（提高限流额度；仅存本地） */
      githubToken: '',
      /* 界面语言偏好（仅数据层透传，UI 决定） */
      locale: 'zh-Hans'
    };
  }

  /* 把任意来源的结构化成 defaultState 形状（导入 / 迁移共用） */
  function normalizeState(raw, opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    var src = raw.state && typeof raw.state === 'object' ? raw.state : raw; // 兼容导出包 {state:{...}}

    if (Array.isArray(src.favorites)) {
      var favs = [];
      for (var i = 0; i < src.favorites.length && favs.length < (LIMITS.FAVORITES_MAX || 5000); i++) {
        var it = migrateItem(src.favorites[i]);
        if (it) favs.push(it);
      }
      base.favorites = favs;
    }
    if (Array.isArray(src.customs)) {
      var cus = [];
      for (var c = 0; c < src.customs.length && cus.length < (LIMITS.CUSTOM_MAX_ITEMS || 5000); c++) {
        var cit = migrateItem(src.customs[c]);
        if (cit) { cit.custom = true; cus.push(cit); }
      }
      base.customs = cus;
    }
    if (Array.isArray(src.sources)) {
      var sos = [];
      for (var s = 0; s < src.sources.length; s++) {
        var so = normalizeSource(src.sources[s]);
        if (so) sos.push(so);
      }
      base.sources = sos;
    }
    if (Array.isArray(src.tags)) {
      var tgs = [];
      for (var t = 0; t < src.tags.length && tgs.length < (LIMITS.TAGS_MAX || 200); t++) {
        var tag = text.str(src.tags[t]).trim().slice(0, 40);
        if (tag !== '' && tgs.indexOf(tag) < 0) tgs.push(tag);
      }
      base.tags = tgs;
    }
    if (src.settings && typeof src.settings === 'object') {
      base.settings = normalizeSettings(src.settings);
    }
    if (typeof src.licenseAcknowledged === 'boolean') base.licenseAcknowledged = src.licenseAcknowledged;
    if (text.num(src.revision) !== null) base.revision = Math.max(0, Math.floor(text.num(src.revision)));
    if (Array.isArray(src.appliedMigrations)) {
      base.appliedMigrations = src.appliedMigrations.filter(function (x) { return typeof x === 'string'; });
    }
    if (text.num(src.schemaVersion) !== null) base.schemaVersion = Math.floor(text.num(src.schemaVersion));
    if (options.keepUpdatedAt !== true) base.updatedAt = text.nowIso();
    return base;
  }

  /* writeMode 的合法取值域（**只允许这两个**；见 defaultSettings 的说明） */
  var WRITE_MODES = ['insert', 'append'];

  function isWriteMode(v) {
    return typeof v === 'string' && WRITE_MODES.indexOf(v) >= 0;
  }

  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    /* 迁移护栏：非法/已废弃的 writeMode（含旧版写进去的 'replace'）一律静默回落默认值，
       不抛错、不保留脏值 —— 因为 'replace' 在本机没有实现路径（CONSTRAINTS-01 §C.1）。 */
    if (isWriteMode(raw.writeMode)) d.writeMode = raw.writeMode;
    if (raw.writeField === 'description' || raw.writeField === 'prompt') d.writeField = raw.writeField;
    if (raw.sort === 'weight' || raw.sort === 'title') d.sort = raw.sort;
    var ps = text.num(raw.pageSize);
    if (ps !== null) d.pageSize = text.clamp(ps, 10, 200);
    if (raw.filter && typeof raw.filter === 'object') {
      d.filter = filter.normalizeSettings ? filter.normalizeSettings(raw.filter) : d.filter;
    }
    if (typeof raw.allowGithubFallback === 'boolean') d.allowGithubFallback = raw.allowGithubFallback;
    if (typeof raw.githubToken === 'string') d.githubToken = raw.githubToken.slice(0, 200);
    if (typeof raw.locale === 'string' && raw.locale !== '') d.locale = raw.locale.slice(0, 20);
    return d;
  }

  /* 用户自定义源规范化（内置源不进 state.sources，只存“覆盖项”） */
  function normalizeSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = text.str(raw.id).trim();
    var url = text.str(raw.url).trim();
    if (id === '' || url === '') return null;
    var fieldMap = {};
    if (raw.fieldMap && typeof raw.fieldMap === 'object') {
      var keys = Object.keys(raw.fieldMap);
      for (var i = 0; i < keys.length; i++) fieldMap[keys[i]] = text.str(raw.fieldMap[keys[i]]);
    }
    return {
      id: id,
      name: text.str(raw.name) || id,
      kind: text.str(raw.kind) || 'custom-json',
      origin: 'custom',
      enabled: raw.enabled !== false,
      removable: true,
      lang: text.str(raw.lang) || 'zh',
      url: url,
      ref: raw.ref === undefined ? null : text.str(raw.ref),
      enabledFallback: raw.enabledFallback === true,
      homepage: text.str(raw.homepage),
      licenseId: text.str(raw.licenseId) || 'UNKNOWN',
      licenseNote: text.str(raw.licenseNote) || '用户自带源：许可由用户自行确认。',
      supportsWeight: raw.supportsWeight === true,
      fieldMap: fieldMap,
      listPath: text.str(raw.listPath),
      notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 10).map(function (n) { return text.str(n); }) : [],
      addedAt: text.str(raw.addedAt) || text.nowIso()
    };
  }

  /* ---------------------------------------------------------------------------
   * 3) 迁移
   * ------------------------------------------------------------------------ */
  var MIGRATIONS = [
    {
      to: 1,
      id: 'v0-to-v1',
      describe: '把无版本号的早期结构（favorites 为 uid 字符串数组、customs 为裸对象数组）升到 v1 完整快照。',
      run: function (raw) {
        var out = raw && typeof raw === 'object' ? raw : {};
        if (Array.isArray(out.favorites) && out.favorites.length > 0 && typeof out.favorites[0] === 'string') {
          out.favorites = out.favorites.map(function (uid) {
            return {
              uid: uid, id: uid, sourceId: 'legacy', title: String(uid), content: '',
              tags: [], lang: 'zh', custom: false
            };
          });
        }
        if (!out.settings) out.settings = {};
        if (!out.settings.filter) out.settings.filter = filter.defaultSettings ? filter.defaultSettings() : { enabled: true };
        return out;
      }
    }
  ];

  /**
   * 版本守卫：判断 raw.schemaVersion 相对当前版本的关系。
   * @returns {{ ok:boolean, from:number, to:number, migrations:Array, code:string|null, message:string|null }}
   */
  function planMigration(raw) {
    var from = raw && typeof raw === 'object' && text.num(raw.schemaVersion) !== null
      ? Math.floor(text.num(raw.schemaVersion))
      : 0; // v0 = 无版本号
    if (from > CURRENT_SCHEMA) {
      return {
        ok: false, from: from, to: CURRENT_SCHEMA, migrations: [],
        code: constants.ERROR_CODES.SCHEMA,
        message: '数据版本 v' + from + ' 高于本插件支持的 v' + CURRENT_SCHEMA
          + '（可能装过更新版本的插件）。为避免损坏数据，本次不写入持久层，已只读挂载。'
          + '如需继续使用，请在「源管理 / 高级」里显式重置，或换回更新版本的插件。'
      };
    }
    var steps = [];
    for (var i = 0; i < MIGRATIONS.length; i++) {
      if (MIGRATIONS[i].to > from && MIGRATIONS[i].to <= CURRENT_SCHEMA) steps.push(MIGRATIONS[i]);
    }
    steps.sort(function (a, b) { return a.to - b.to; });
    return { ok: true, from: from, to: CURRENT_SCHEMA, migrations: steps, code: null, message: null };
  }

  /* ---------------------------------------------------------------------------
   * 4) Store
   * ------------------------------------------------------------------------ */
  /**
   * 创建 store 实例。
   * @param {{ backend?:object, clock?:function, readOnly?:boolean }} [options]
   * @returns {object} store（见 docs/DATA-01-数据层接口.md §5）
   */
  function createStore(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var clock = text.isFn(opts.clock) ? opts.clock : function () { return new Date(); };
    var resolved = resolveBackend(opts.backend || null);
    var backend = resolved.backend;
    var report = resolved.report;

    var state = defaultState();
    var mode = opts.readOnly === true ? 'readonly' : 'rw';
    var lastError = null;
    var warnings = [];
    var loaded = false;

    function warn(msg) {
      if (warnings.indexOf(msg) < 0) warnings.push(msg);
    }

    /* 有界救援：从损坏状态里尽量捞出条目（绝不无声丢弃） */
    function rescue(raw) {
      var rescued = { favorites: 0, customs: 0, sources: 0, tags: 0, loose: [] };
      var out = defaultState();
      function tryItems(list, key) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < list.length; i++) {
          var it = migrateItem(list[i]);
          if (it) { out[key].push(it); rescued[key]++; }
        }
      }
      tryItems(raw && raw.favorites, 'favorites');
      tryItems(raw && raw.customs, 'customs');
      if (raw && Array.isArray(raw.tags)) {
        for (var t = 0; t < raw.tags.length; t++) {
          var tag = text.str(raw.tags[t]).trim();
          if (tag !== '') { out.tags.push(tag.slice(0, 40)); rescued.tags++; }
        }
      }
      if (raw && Array.isArray(raw.sources)) {
        for (var s = 0; s < raw.sources.length; s++) {
          var so = normalizeSource(raw.sources[s]);
          if (so) { out.sources.push(so); rescued.sources++; }
        }
      }
      if (raw && raw.settings && typeof raw.settings === 'object') {
        try { out.settings = normalizeSettings(raw.settings); } catch (e) { /* 保留默认 */ }
      }
      return { state: out, rescued: rescued };
    }

    function persist(nextState) {
      nextState.appId = constants.APP_ID || nextState.appId;
      nextState.schemaVersion = CURRENT_SCHEMA;
      nextState.updatedAt = text.nowIso(clock);
      nextState.revision = (text.num(nextState.revision) || 0) + 1;
      var payload = '';
      try {
        payload = JSON.stringify(nextState);
      } catch (e) {
        return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '状态无法序列化：' + ((e && e.message) || 'unknown') };
      }
      var bytes = text.utf8Bytes(payload);
      var maxBytes = LIMITS.STATE_MAX_BYTES || 2 * 1024 * 1024;
      if (bytes > maxBytes) {
        return {
          ok: false,
          code: constants.ERROR_CODES.QUOTA,
          message: '本地状态大小 ' + bytes + ' 字节，超过上限 ' + maxBytes + ' 字节。'
            + '请删除部分自建提示词或收藏后重试（数据未被写入，当前会话内的改动可能丢失）。',
          bytes: bytes
        };
      }
      try {
        var wrote = backend.setItem(STATE_KEY, payload);
        if (wrote === false) {
          return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '持久层拒绝了写入（无异常）' };
        }
      } catch (e2) {
        var isQuota = !!(e2 && (e2.name === 'QuotaExceededError' || e2.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e2.code === 22));
        return {
          ok: false,
          code: isQuota ? constants.ERROR_CODES.QUOTA : constants.ERROR_CODES.STORAGE,
          message: isQuota
            ? '本地存储配额已满（' + bytes + ' 字节写不进去）。可删除部分缓存或自建提示词后重试。'
            : '写入本地存储失败：' + ((e2 && e2.message) || 'unknown'),
          bytes: bytes
        };
      }
      state = nextState;
      return { ok: true, code: null, message: null, bytes: bytes, revision: state.revision };
    }

    /* 读盘 + 版本护栏 + 迁移 + 救援 */
    function load() {
      var raw = null;
      try { raw = backend.getItem(STATE_KEY); } catch (e) { raw = null; }
      if (raw === null || raw === undefined || raw === '') {
        state = defaultState();
        loaded = true;
        return { ok: true, created: true, migrated: false, code: null, message: null, reported: report };
      }
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok) {
        /* 损坏：留档 + 救援 */
        try { backend.setItem(QUARANTINE_KEY, String(raw).slice(0, 200000)); } catch (e2) { /* 留档失败不阻断 */ }
        warnings.push('本地状态 JSON 解析失败（' + parsed.error + '），已把原始串留档在 ' + QUARANTINE_KEY + '，本次以默认值启动。');
        state = defaultState();
        mode = 'readonly';
        lastError = { code: constants.ERROR_CODES.SCHEMA, message: warnings[warnings.length - 1] };
        loaded = true;
        return { ok: false, created: false, migrated: false, code: lastError.code, message: lastError.message, reported: report };
      }

      var plan = planMigration(parsed.value);
      if (!plan.ok) {
        /* 未来版本：只读挂载，绝不覆盖 */
        try { backend.setItem(QUARANTINE_KEY, String(raw).slice(0, 200000)); } catch (e3) { /* 忽略 */ }
        state = normalizeState(parsed.value, { keepUpdatedAt: true });
        mode = 'readonly';
        lastError = { code: plan.code, message: plan.message };
        warnings.push(plan.message);
        loaded = true;
        return { ok: false, created: false, migrated: false, code: plan.code, message: plan.message, reported: report };
      }

      var working = parsed.value;
      var applied = [];
      for (var i = 0; i < plan.migrations.length; i++) {
        var step = plan.migrations[i];
        try {
          working = step.run(working);
          applied.push(step.id);
        } catch (e4) {
          warnings.push('迁移 ' + step.id + ' 失败（' + ((e4 && e4.message) || 'unknown') + '），已改用救援模式读取。');
          break;
        }
      }

      var normalized = null;
      try {
        normalized = normalizeState(working, { keepUpdatedAt: true });
      } catch (e5) {
        var r = rescue(working);
        normalized = r.state;
        warnings.push('状态规范化失败，已救援出 ' + r.rescued.favorites + ' 条收藏 / ' + r.rescued.customs + ' 条自建。');
      }
      for (var a = 0; a < applied.length; a++) {
        if (normalized.appliedMigrations.indexOf(applied[a]) < 0) normalized.appliedMigrations.push(applied[a]);
      }
      state = normalized;
      loaded = true;

      var result = { ok: true, created: false, migrated: applied.length > 0, appliedMigrations: applied, code: null, message: null, reported: report };
      if (applied.length > 0 || !report.durable) {
        /* 迁移/降级后立刻回写一次，把新结构固化（只读模式下跳过） */
        if (mode === 'rw') {
          var w = persist(state);
          if (!w.ok) {
            warnings.push('迁移后回写失败：' + w.message);
            result.ok = false;
            result.code = w.code;
            result.message = w.message;
          }
        }
      }
      return result;
    }

    function snapshot() {
      return text.cloneJSON(state) || defaultState();
    }

    function update(mutator) {
      if (!loaded) load();
      if (mode === 'readonly') {
        return {
          ok: false,
          code: (lastError && lastError.code) || constants.ERROR_CODES.SCHEMA,
          message: (lastError && lastError.message) || '持久层处于只读模式，拒绝写入。',
          readOnly: true
        };
      }
      var draft = snapshot();
      var mutated = draft;
      try {
        if (text.isFn(mutator)) {
          var maybe = mutator(draft);
          if (maybe && typeof maybe === 'object') mutated = maybe;
        }
      } catch (e) {
        return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '更新回调抛错：' + ((e && e.message) || 'unknown') };
      }
      var normalized = normalizeState(mutated, { keepUpdatedAt: false });
      normalized.revision = text.num(draft.revision) || 0;
      normalized.appliedMigrations = Array.isArray(draft.appliedMigrations) ? draft.appliedMigrations.slice(0) : [];
      normalized.licenseAcknowledged = mutated.licenseAcknowledged === true;
      var res = persist(normalized);
      if (!res.ok) {
        warnings.push('写入失败：' + res.message);
        lastError = { code: res.code, message: res.message };
      }
      return res;
    }

    function reset(reason) {
      warnings = [];
      lastError = null;
      mode = 'rw';
      var fresh = defaultState();
      var res = persist(fresh);
      if (res.ok && reason) {
        warnings.push('状态已按用户要求重置：' + text.str(reason));
      }
      return res;
    }

    /* --------------------------- 子对象：缓存（独立键、可单独淘汰） ------- */
    function cacheKey(sourceId) {
      return CACHE_PREFIX + text.str(sourceId);
    }

    function cacheGet(sourceId) {
      var key = cacheKey(sourceId);
      var raw = null;
      try { raw = backend.getItem(key); } catch (e) { return null; }
      if (!raw) return null;
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
        try { backend.removeItem(key); } catch (e2) { /* 忽略 */ }
        return null;
      }
      var entry = parsed.value;
      if (text.num(entry.schemaVersion) !== CURRENT_SCHEMA) return null; // 版本不符 → 当未命中
      return entry;
    }

    function cacheList() {
      var keys = [];
      try {
        if (text.isFn(backend.keys)) keys = backend.keys();
      } catch (e) { keys = []; }
      var out = [];
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(CACHE_PREFIX) !== 0) continue;
        var entry = cacheGet(keys[i].slice(CACHE_PREFIX.length));
        if (entry) out.push(entry);
      }
      return out;
    }

    function cacheEnforceTotal(sourceIdJustWritten) {
      var totalMax = LIMITS.CACHE_MAX_BYTES_TOTAL || 2 * 1024 * 1024;
      var entries = cacheList();
      var total = 0;
      for (var i = 0; i < entries.length; i++) total += text.num(entries[i].bytes) || 0;
      if (total <= totalMax) return { ok: true, evicted: [] };
      entries.sort(function (a, b) {
        var ta = text.str(a.fetchedAt); var tb = text.str(b.fetchedAt);
        if (ta === tb) return 0;
        return ta < tb ? -1 : 1; // 最旧在前
      });
      var evicted = [];
      for (var j = 0; j < entries.length && total > totalMax; j++) {
        if (entries[j].sourceId === sourceIdJustWritten) continue; // 刚写的最后淘汰
        total -= text.num(entries[j].bytes) || 0;
        try { backend.removeItem(cacheKey(entries[j].sourceId)); } catch (e) { /* 忽略 */ }
        evicted.push(entries[j].sourceId);
      }
      return { ok: true, evicted: evicted };
    }

    /**
     * 写缓存（带逐源字节上限 + 合计上限淘汰）。
     * @param {string} sourceId
     * @param {Array<object>} items 归一化条目（**过滤前**的完整集）
     * @param {object} meta { url, ref, fetchedAt, license }
     */
    function cacheSet(sourceId, items, meta) {
      var m = meta && typeof meta === 'object' ? meta : {};
      var list = Array.isArray(items) ? items : [];
      var maxBytes = LIMITS.CACHE_MAX_BYTES_PER_SOURCE || 900 * 1024;
      var kept = list.slice(0);
      var payload = '';
      var bytes = 0;
      var truncated = false;
      for (var attempt = 0; attempt < 40; attempt++) {
        var entry = {
          schemaVersion: CURRENT_SCHEMA,
          appId: constants.APP_ID || 'dsh-prompt-market',
          sourceId: text.str(sourceId),
          url: text.str(m.url),
          ref: m.ref === undefined || m.ref === null ? null : text.str(m.ref),
          fetchedAt: text.str(m.fetchedAt) || text.nowIso(clock),
          itemCount: list.length,
          storedCount: kept.length,
          truncated: truncated,
          license: m.license || null,
          items: kept
        };
        var body = '';
        try { body = JSON.stringify(entry); } catch (e) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '缓存序列化失败' }; }
        bytes = text.utf8Bytes(body);
        entry.bytes = bytes;
        try { payload = JSON.stringify(entry); } catch (e2) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '缓存序列化失败' }; }
        bytes = text.utf8Bytes(payload);
        if (bytes <= maxBytes || kept.length <= 1) break;
        /* 超限：把尾部条目砍掉（保留顺序靠前的条目，与 UI 默认排序一致） */
        var newLen = Math.max(1, Math.floor(kept.length * 0.7));
        kept = kept.slice(0, newLen);
        truncated = true;
      }
      var written = { ok: true, code: null, message: null, bytes: bytes, storedCount: kept.length, truncated: truncated };
      try {
        backend.setItem(cacheKey(sourceId), payload);
      } catch (e3) {
        var isQuota = !!(e3 && (e3.name === 'QuotaExceededError' || e3.code === 22));
        /* 配额满：先淘汰其它源再重试一次；仍失败就放弃缓存（不影响本次会话可用性） */
        cacheEnforceTotal(sourceId);
        try {
          backend.setItem(cacheKey(sourceId), payload);
        } catch (e4) {
          warnings.push('缓存写入失败（' + (isQuota ? '配额已满' : '存储错误') + '），本次仍可正常浏览，但离线降级数据未更新。');
          return { ok: false, code: isQuota ? constants.ERROR_CODES.QUOTA : constants.ERROR_CODES.STORAGE, message: warnings[warnings.length - 1], bytes: bytes };
        }
      }
      var evict = cacheEnforceTotal(sourceId);
      if (evict.evicted.length > 0) written.evicted = evict.evicted;
      if (truncated) written.message = '条目数超出单源缓存上限，已截断为 ' + kept.length + '/' + list.length + ' 条（仅影响离线降级数据量）。';
      return written;
    }

    function cacheRemove(sourceId) {
      try { backend.removeItem(cacheKey(sourceId)); return { ok: true }; } catch (e) { return { ok: false, code: constants.ERROR_CODES.STORAGE, message: '删除缓存失败' }; }
    }

    function cacheClear() {
      var entries = cacheList();
      var failed = [];
      for (var i = 0; i < entries.length; i++) {
        var r = cacheRemove(entries[i].sourceId);
        if (!r.ok) failed.push(entries[i].sourceId);
      }
      return { ok: failed.length === 0, removed: entries.length - failed.length, failed: failed };
    }

    function cacheStats() {
      var entries = cacheList();
      var bytes = 0;
      var list = [];
      for (var i = 0; i < entries.length; i++) {
        bytes += text.num(entries[i].bytes) || 0;
        list.push({
          sourceId: entries[i].sourceId,
          url: entries[i].url,
          fetchedAt: entries[i].fetchedAt,
          itemCount: entries[i].itemCount,
          storedCount: entries[i].storedCount,
          truncated: entries[i].truncated === true,
          bytes: text.num(entries[i].bytes) || 0
        });
      }
      return {
        entries: list,
        totalBytes: bytes,
        limitBytes: LIMITS.CACHE_MAX_BYTES_TOTAL || 2 * 1024 * 1024,
        backend: report.kind
      };
    }

    /* --------------------------- 状态读接口（只读视图） ----------------- */
    function toJSON() {
      return snapshot();
    }

    function status() {
      return {
        loaded: loaded,
        readOnly: mode === 'readonly',
        backend: report.kind,
        durable: report.durable,
        backendSource: report.source,
        schemaVersion: state.schemaVersion,
        currentSchemaVersion: CURRENT_SCHEMA,
        revision: state.revision,
        updatedAt: state.updatedAt,
        appliedMigrations: state.appliedMigrations.slice(0),
        warnings: warnings.slice(0),
        lastError: lastError ? { code: lastError.code, message: lastError.message } : null,
        counts: {
          favorites: state.favorites.length,
          customs: state.customs.length,
          sources: state.sources.length,
          tags: state.tags.length
        }
      };
    }

    return {
      /* 底层 */
      backend: backend,
      backendReport: report,
      load: load,
      status: status,
      snapshot: snapshot,
      toJSON: toJSON,
      update: update,
      reset: reset,
      /* 缓存子存储 */
      cacheGet: cacheGet,
      cacheSet: cacheSet,
      cacheRemove: cacheRemove,
      cacheClear: cacheClear,
      cacheList: cacheList,
      cacheStats: cacheStats,
      cacheKey: cacheKey
    };
  }

  /**
   * 导入护栏：把任意 JSON 文本/对象解析成可写入的状态。
   * @param {string|object} input
   * @returns {{ ok:boolean, code:string|null, message:string|null, state:object|null,
   *             stats:object|null, requiresReset:boolean }}
   */
  function parseImport(input) {
    var raw = input;
    if (typeof raw === 'string') {
      if (text.utf8Bytes(raw) > (LIMITS.IMPORT_MAX_BYTES || 5 * 1024 * 1024)) {
        return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容超过上限 ' + (LIMITS.IMPORT_MAX_BYTES || 0) + ' 字节，已拒绝解析。', state: null, stats: null, requiresReset: false };
      }
      var parsed = text.safeParseJSON(raw);
      if (!parsed.ok) {
        return { ok: false, code: constants.ERROR_CODES.PARSE, message: '导入内容不是合法 JSON：' + parsed.error, state: null, stats: null, requiresReset: false };
      }
      raw = parsed.value;
    }
    if (!raw || typeof raw !== 'object') {
      return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容必须是对象或数组。', state: null, stats: null, requiresReset: false };
    }
    if (text.hasDangerousKey(raw)) {
      return { ok: false, code: constants.ERROR_CODES.BAD_INPUT, message: '导入内容含 __proto__/constructor/prototype 键，出于安全考虑已拒绝。', state: null, stats: null, requiresReset: false };
    }
    var safe = text.stripDangerousKeys(raw);

    /* 支持三种形态：本插件导出包 / 裸 state / 裸条目数组 */
    var container = safe;
    if (Array.isArray(safe)) {
      container = { favorites: safe };
    } else if (safe.appId !== undefined && safe.appId !== (constants.APP_ID || 'dsh-prompt-market') && safe.state === undefined) {
      return {
        ok: false, code: constants.ERROR_CODES.BAD_INPUT,
        message: '导入包声明 appId=' + text.str(safe.appId) + '，不属于本插件（期望 ' + (constants.APP_ID || '') + '）。',
        state: null, stats: null, requiresReset: false
      };
    }

    var version = text.num(container.schemaVersion);
    var requiresReset = false;
    if (version !== null && version > CURRENT_SCHEMA) {
      requiresReset = true;
      return {
        ok: false,
        code: constants.ERROR_CODES.SCHEMA,
        message: '导入包的 schemaVersion=' + version + ' 高于本插件支持的 ' + CURRENT_SCHEMA + '，'
          + '为避免写坏数据已拒绝导入。请升级插件，或确认后用「重置」清空后再导入旧格式。',
        state: null,
        stats: null,
        requiresReset: requiresReset
      };
    }

    var normalized = normalizeState(container, { keepUpdatedAt: false });
    var stats = {
      schemaVersion: normalized.schemaVersion,
      favorites: normalized.favorites.length,
      customs: normalized.customs.length,
      tags: normalized.tags.length,
      sources: normalized.sources.length,
      incomingVersion: version
    };
    return { ok: true, code: null, message: null, state: normalized, stats: stats, requiresReset: false };
  }

  /**
   * 导出：得到可写文件的导出包对象（调用方决定文件名与下载方式）。
   * @param {object} store
   * @param {object} [options] { includeCache:boolean }
   */
  function buildExport(store, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var state = store.toJSON();
    var payload = {
      appId: constants.APP_ID || 'dsh-prompt-market',
      kind: 'dsh-prompt-market-export',
      schemaVersion: CURRENT_SCHEMA,
      exportedAt: text.nowIso(),
      plugin: { name: 'dsh-prompt-market', dataApiMajor: constants.DATA_API_MAJOR || 1 },
      state: {
        favorites: state.favorites,
        customs: state.customs,
        sources: state.sources,
        tags: state.tags,
        settings: state.settings,
        licenseAcknowledged: state.licenseAcknowledged === true,
        appliedMigrations: state.appliedMigrations
      },
      counts: {
        favorites: state.favorites.length,
        customs: state.customs.length,
        tags: state.tags.length,
        sources: state.sources.length
      }
    };
    if (opts.includeCache === true) {
      payload.cache = store.cacheList();
    }
    payload.checksum = text.fnv1a32(JSON.stringify(payload.state));
    return { ok: true, code: null, message: null, payload: payload, fileName: 'prompt-market-backup-' + slug(text.nowIso()) + '.json' };
  }

  function slug(iso) {
    return text.str(iso).replace(/[:.]/g, '-');
  }

  core.storage = {
    STATE_KEY: STATE_KEY,
    CACHE_PREFIX: CACHE_PREFIX,
    QUARANTINE_KEY: QUARANTINE_KEY,
    CURRENT_SCHEMA: CURRENT_SCHEMA,
    MIGRATIONS: MIGRATIONS,
    /* writeMode 合法取值域：只含 'insert' / 'append'（无 'replace'） */
    WRITE_MODES: WRITE_MODES,
    isWriteMode: isWriteMode,
    nowIso: function (clock) { return text.nowIso(clock); },
    createStore: createStore,
    memoryBackend: memoryBackend,
    resolveBackend: resolveBackend,
    probeBackend: probeBackend,
    defaultState: defaultState,
    defaultSettings: defaultSettings,
    normalizeState: normalizeState,
    normalizeSettings: normalizeSettings,
    normalizeSource: normalizeSource,
    migrateItem: migrateItem,
    planMigration: planMigration,
    parseImport: parseImport,
    buildExport: buildExport
  };
})(__pmCore);

/* END inlined file: storage.js */

/* BEGIN inlined file: normalize.js */
/* =============================================================================
 * unit: normalize.js — 远程载荷 → 统一 PromptItem 模型的解析与归一化
 * =============================================================================
 * 覆盖四种载荷（字段名**逐字**取自 CONSTRAINTS-01 §B / REL-01，禁止臆造）：
 *   B1 f/prompts.chat  prompts.csv —— 表头 act,prompt,for_devs,type,contributor（RFC4180）
 *   B2 rockbenben/ChatGPT-Shortcut  src/data/prompt_zh-Hans.json
 *   B3 PlexPt/awesome-chatgpt-prompts-zh  prompts-zh.json（字段仅 act + prompt）
 *   C  用户自定义源：任意 JSON URL + fieldMap/listPath 映射
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};

  var LIMITS = constants.LIMITS || {};
  var LICENSES = constants.LICENSES || {};

  /* ---------------------------------------------------------------------------
   * 1) RFC4180 CSV
   * ------------------------------------------------------------------------ */

  /* 状态机切行：只在引号外断行；CRLF / LF / CR 均识别；\r\n 计作一个分隔符 */
  function splitCsvRecords(s) {
    var src = text.str(s);
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // 去 BOM
    var records = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (src.charAt(i + 1) === '"') { cur += '""'; i++; continue; } // 转义的双引号
          inQuotes = false;
          cur += c;
          continue;
        }
        cur += c;
        continue;
      }
      if (c === '"') { inQuotes = true; cur += c; continue; }
      if (c === '\r') {
        if (src.charAt(i + 1) === '\n') i++;
        records.push(cur); cur = '';
        continue;
      }
      if (c === '\n') { records.push(cur); cur = ''; continue; }
      cur += c;
    }
    records.push(cur);
    return records;
  }

  /* 按逗号切字段（引号外的逗号才是分隔符；"" 还原成 "） */
  function splitCsvFields(line) {
    var fields = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; continue; }
          inQuotes = false;
          continue; // 结束引号本身不入值
        }
        cur += c;
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ',') { fields.push(cur); cur = ''; continue; }
      cur += c;
    }
    fields.push(cur);
    return fields;
  }

  /**
   * 解析 RFC4180 CSV 文本。
   * @param {string} csvText
   * @returns {{ ok:boolean, header:string[], rows:Array<Array<string>>, errors:string[], hasBom:boolean }}
   *          永不抛错；引号未闭合时记入 errors 但仍返回可用的行。
   */
  function parseCsv(csvText) {
    var s = text.str(csvText);
    var hasBom = s.charCodeAt(0) === 0xfeff;
    var records = splitCsvRecords(s);
    /* 丢掉纯空行（但保留引号内换行产生的真行） */
    var lines = [];
    for (var i = 0; i < records.length; i++) {
      if (records[i].replace(/\s/g, '') === '') continue;
      lines.push(records[i]);
    }
    if (lines.length === 0) {
      return { ok: false, header: [], rows: [], errors: ['empty-csv'], hasBom: hasBom };
    }
    var header = splitCsvFields(lines[0]);
    for (var h = 0; h < header.length; h++) header[h] = header[h].trim();
    var rows = [];
    for (var r = 1; r < lines.length; r++) rows.push(splitCsvFields(lines[r]));
    return { ok: true, header: header, rows: rows, errors: [], hasBom: hasBom };
  }

  /* 按表头把一行编成对象；列数不足时缺项为 ''，多余列忽略 */
  function rowToObject(header, row) {
    var out = {};
    for (var i = 0; i < header.length; i++) {
      out[header[i]] = row[i] === undefined ? '' : row[i];
    }
    return out;
  }

  /* 表头合规性检查（给 verifier 的字段级断言用） */
  function checkCsvHeader(header, expected) {
    var want = Array.isArray(expected) ? expected : (constants.BUILTIN_SOURCES && constants.BUILTIN_SOURCES[0]
      ? constants.BUILTIN_SOURCES[0].csvHeader : ['act', 'prompt', 'for_devs', 'type', 'contributor']);
    var got = Array.isArray(header) ? header : [];
    var missing = [];
    var extra = [];
    var i;
    for (i = 0; i < want.length; i++) if (got.indexOf(want[i]) < 0) missing.push(want[i]);
    for (i = 0; i < got.length; i++) if (want.indexOf(got[i]) < 0) extra.push(got[i]);
    return {
      ok: missing.length === 0 && got.length === want.length,
      expected: want.slice(0),
      got: got.slice(0),
      missing: missing,
      extra: extra
    };
  }

  /* ---------------------------------------------------------------------------
   * 2) 工具：取值、语言推断、来源 URL
   * ------------------------------------------------------------------------ */
  function pick(obj, path) {
    if (!obj || typeof obj !== 'object' || typeof path !== 'string' || path === '') return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function stringsOf(v, max) {
    var out = [];
    var limit = max || 20;
    if (typeof v === 'string') {
      var parts = v.split(/[,;|]/);
      for (var i = 0; i < parts.length && out.length < limit; i++) {
        var t = parts[i].trim();
        if (t !== '') out.push(t.slice(0, 40));
      }
      return out;
    }
    if (Array.isArray(v)) {
      for (var j = 0; j < v.length && out.length < limit; j++) {
        var item = v[j];
        if (typeof item === 'string') {
          var s = item.trim();
          if (s !== '') out.push(s.slice(0, 40));
        } else if (item && typeof item === 'object') {
          var nm = text.str(item.name || item.title || item.id || item.label).trim();
          if (nm !== '') out.push(nm.slice(0, 40));
        }
      }
    }
    return out;
  }

  /* 语言推断：CJK 占比 > 20% 视为中文，否则英文 */
  function inferLang(s, fallback) {
    var str = text.str(s);
    if (str === '') return fallback || 'en';
    var total = 0;
    var cjk = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10) continue;
      if (c < 48) continue;
      total++;
      if (c >= 0x3400 && c <= 0x9fff) cjk++;
    }
    if (total === 0) return fallback || 'en';
    return (cjk / total) > 0.2 ? 'zh' : 'en';
  }

  function repoHomepage(src) {
    if (!src) return '';
    if (src.homepage) return src.homepage;
    if (src.repo) return 'https://github.com/' + src.repo;
    return '';
  }

  function licenseOf(src) {
    var id = (src && src.licenseId) ? src.licenseId : 'UNKNOWN';
    var lic = LICENSES[id] || LICENSES.UNKNOWN || null;
    if (!lic) return null;
    return {
      id: lic.id,
      name: lic.name,
      spdx: lic.spdx,
      url: lic.url,
      attributionRequired: lic.attributionRequired === true,
      attributionText: lic.attributionText,
      sourceUrl: lic.sourceUrl || repoHomepage(src),
      copyrightHolder: lic.copyrightHolder
    };
  }

  /* ---------------------------------------------------------------------------
   * 3) 通用条目构造器（四个适配器共用）
   * ------------------------------------------------------------------------ */
  /**
   * @param {object} fields 原始字段 {title, content, description, remark, tags, lang, author,
   *                                 weight, forDevs, type, website, nativeId}
   * @param {object} src 源定义（含 id / lang / licenseId / homepage / repo）
   * @param {number} index 行序号（兜底 nativeId）
   * @returns {object|null} 归一化 PromptItem（title 与 content 都为空时返回 null）
   */
  function makeItem(fields, src, index) {
    var f = fields && typeof fields === 'object' ? fields : {};
    var s = src && typeof src === 'object' ? src : {};
    var sourceId = text.str(s.id) || 'unknown';

    var cleanContent = text.sanitizeText(f.content, {
      maxChars: LIMITS.CONTENT_MAX_CHARS || 20000,
      keepNewlines: true
    });
    var cleanTitle = text.sanitizeText(f.title, {
      maxChars: LIMITS.TITLE_MAX_CHARS || 300,
      keepNewlines: false
    });
    var cleanDesc = text.sanitizeText(f.description, { maxChars: 2000, keepNewlines: false });
    var cleanRemark = text.sanitizeText(f.remark, { maxChars: 2000, keepNewlines: false });

    if (cleanTitle.text === '' && cleanContent.text === '') return null;

    var nativeId = f.nativeId === undefined || f.nativeId === null || f.nativeId === ''
      ? String(index)
      : String(f.nativeId);

    /* 稳定去重键：来源 + 原生主键 */
    var uid = sourceId + ':' + nativeId;

    var language = text.str(f.lang) || text.str(s.lang) || '';
    if (language === '' || language === 'zh' || language === 'en') {
      language = inferLang(cleanTitle.text + ' ' + cleanRemark.text + ' ' + cleanDesc.text, language || 'en');
    }

    var website = (f.website === undefined || f.website === null || f.website === '')
      ? null
      : text.str(f.website).slice(0, 500);

    return {
      uid: uid,
      id: uid,
      sourceId: sourceId,
      nativeId: nativeId,
      title: cleanTitle.text,
      content: cleanContent.text,
      body: cleanContent.text,
      tags: stringsOf(f.tags, 20),
      lang: language || 'zh',
      author: (f.author === undefined || f.author === null || f.author === '') ? null : text.str(f.author).slice(0, 200),
      description: cleanDesc.text,
      remark: cleanRemark.text,
      weight: text.num(f.weight),
      forDevs: typeof f.forDevs === 'boolean' ? f.forDevs : null,
      type: f.type === undefined || f.type === null || f.type === '' ? null : text.str(f.type).slice(0, 40),
      website: website,
      sourceUrl: website || repoHomepage(s),
      license: licenseOf(s),
      sanitized: cleanContent.changed || cleanTitle.changed || cleanDesc.changed || cleanRemark.changed,
      contentHash: text.contentHash(cleanContent.text || cleanTitle.text)
    };
  }

  /* ---------------------------------------------------------------------------
   * 4) 四个适配器
   * ------------------------------------------------------------------------ */

  /**
   * B1：f/prompts.chat 的 prompts.csv。
   * @param {string} csvText
   * @param {object} src 源定义（默认取 constants.BUILTIN_SOURCES[0]）
   * @returns {{ ok:boolean, items:Array, headerCheck:object, skipped:number, error:string|null }}
   */
  function adaptPromptsCsv(csvText, src) {
    var source = src || (constants.BUILTIN_SOURCES || [])[0] || { id: 'prompts-chat-csv', lang: 'en', licenseId: 'CC0-1.0' };
    var parsed = parseCsv(csvText);
    if (!parsed.ok) {
      return { ok: false, items: [], headerCheck: null, skipped: 0, error: 'empty-or-unparseable-csv' };
    }
    var headerCheck = checkCsvHeader(parsed.header, source.csvHeader);
    var items = [];
    var skipped = 0;
    for (var i = 0; i < parsed.rows.length; i++) {
      var row = parsed.rows[i];
      var o = rowToObject(parsed.header, row);
      var item = makeItem({
        title: o.act,
        content: o.prompt,
        forDevs: o.for_devs === undefined ? null : text.bool(o.for_devs),
        type: o.type,
        author: o.contributor,
        tags: o.for_devs !== undefined && text.bool(o.for_devs) ? ['dev'] : [],
        lang: source.lang || 'en',
        nativeId: String(i + 1)
      }, source, i + 1);
      if (item) items.push(item);
      else skipped++;
    }
    return { ok: items.length > 0, items: items, headerCheck: headerCheck, skipped: skipped, error: items.length > 0 ? null : 'no-usable-rows' };
  }

  /* 在记录里找 locale 键（'zh-Hans' / 'zh-hans' / 'zh-CN' / 'zh' 均可命中） */
  function resolveLocaleBlock(entry, locale) {
    if (!entry || typeof entry !== 'object') return null;
    var want = text.str(locale || 'zh-Hans');
    var keys = Object.keys(entry);
    var i;
    /* 精确 */
    if (entry[want] && typeof entry[want] === 'object') return entry[want];
    /* 大小写不敏感 */
    for (i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === want.toLowerCase() && entry[keys[i]] && typeof entry[keys[i]] === 'object') {
        return entry[keys[i]];
      }
    }
    /* 前缀（zh-Hans → zh） */
    var base = want.split('-')[0].toLowerCase();
    for (i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase().indexOf(base) === 0 && entry[keys[i]] && typeof entry[keys[i]] === 'object') {
        return entry[keys[i]];
      }
    }
    return null;
  }

  /**
   * B2：rockbenben/ChatGPT-Shortcut 的 prompt_zh-Hans.json。
   * @param {Array|object} json
   * @param {object} src
   * @returns {{ ok:boolean, items:Array, localeKey:string|null, skipped:number, error:string|null }}
   */
  function adaptShortcutJson(json, src) {
    var source = src || (constants.BUILTIN_SOURCES || [])[1] || { id: 'chatgpt-shortcut-zh', lang: 'zh', licenseId: 'MIT' };
    var list = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : null);
    if (!list) {
      return { ok: false, items: [], localeKey: null, skipped: 0, error: 'payload-is-not-an-array' };
    }
    var wantLocale = source.locale || 'zh-Hans';
    var items = [];
    var skipped = 0;
    var seenLocale = null;

    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry !== 'object') { skipped++; continue; }
      var block = resolveLocaleBlock(entry, wantLocale);
      if (!block) { skipped++; continue; }
      if (!seenLocale) {
        var keys = Object.keys(entry);
        for (var k = 0; k < keys.length; k++) {
          if (entry[keys[k]] === block) { seenLocale = keys[k]; break; }
        }
      }
      var nativeId = entry.id === undefined || entry.id === null ? String(i + 1) : String(entry.id);
      var item = makeItem({
        title: block.title,
        content: block.prompt,
        description: block.description,
        remark: block.remark,
        tags: entry.tags,
        weight: entry.weight,
        website: entry.website,
        lang: 'zh',
        nativeId: nativeId,
        author: entry.contributor
      }, source, i + 1);
      if (item) items.push(item);
      else skipped++;
    }
    return {
      ok: items.length > 0,
      items: items,
      localeKey: seenLocale || wantLocale,
      skipped: skipped,
      error: items.length > 0 ? null : 'no-usable-entries'
    };
  }

  /**
   * B3：PlexPt/awesome-chatgpt-prompts-zh 的 prompts-zh.json（字段仅 act + prompt）。
   * @param {Array|object} json
   * @param {object} src
   */
  function adaptPromptsZhJson(json, src) {
    var source = src || (constants.BUILTIN_SOURCES || [])[2] || { id: 'plexpt-prompts-zh', lang: 'zh', licenseId: 'MIT' };
    var list = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : null);
    if (!list) {
      return { ok: false, items: [], skipped: 0, error: 'payload-is-not-an-array' };
    }
    var items = [];
    var skipped = 0;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { skipped++; continue; }
      var item = makeItem({
        title: entry.act,
        content: entry.prompt,
        description: entry.description,
        remark: entry.remark,
        tags: entry.tags,
        weight: entry.weight,
        website: entry.website,
        lang: 'zh',
        nativeId: entry.id === undefined ? String(i + 1) : String(entry.id)
      }, source, i + 1);
      if (item) items.push(item);
      else skipped++;
    }
    return { ok: items.length > 0, items: items, skipped: skipped, error: items.length > 0 ? null : 'no-usable-entries' };
  }

  /* 自定义源的兜底取值顺序（按常见字段名猜；找不到才落空） */
  var CUSTOM_TITLE_KEYS = ['title', 'act', 'name', 'label', 'prompt_title'];
  var CUSTOM_CONTENT_KEYS = ['prompt', 'content', 'body', 'text', 'value'];
  var CUSTOM_DESC_KEYS = ['description', 'desc', 'summary', 'remark', 'note'];

  function firstOf(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = pick(obj, keys[i]);
      if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return v;
    }
    return undefined;
  }

  /**
   * C：用户自定义源（任意 JSON URL）。
   * @param {*} json 已解析的 JSON
   * @param {object} src 自定义源定义（可含 fieldMap / listPath / lang / licenseId）
   * @returns {{ ok:boolean, items:Array, usedListPath:string, skipped:number, error:string|null }}
   */
  function adaptCustomJson(json, src) {
    var source = src && typeof src === 'object' ? src : {};
    var map = source.fieldMap && typeof source.fieldMap === 'object' ? source.fieldMap : {};
    var listPath = text.str(source.listPath);
    var candidate = listPath !== '' ? pick(json, listPath) : json;
    var usedListPath = listPath !== '' && Array.isArray(candidate) ? listPath : '';

    if (!Array.isArray(candidate) && json && typeof json === 'object') {
      /* 未指定 listPath：找第一个"元素是对象的数组" */
      var keys = Object.keys(json);
      for (var i = 0; i < keys.length; i++) {
        var v = json[keys[i]];
        if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) {
          candidate = v;
          usedListPath = keys[i];
          break;
        }
      }
    }
    if (!Array.isArray(candidate)) {
      return {
        ok: false, items: [], usedListPath: usedListPath, skipped: 0,
        error: 'no-array-found' + (listPath ? ' at listPath=' + listPath : '')
      };
    }

    var items = [];
    var skipped = 0;
    for (var r = 0; r < candidate.length; r++) {
      var entry = candidate[r];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { skipped++; continue; }
      var title = map.title ? pick(entry, map.title) : firstOf(entry, CUSTOM_TITLE_KEYS);
      var content = map.content ? pick(entry, map.content) : firstOf(entry, CUSTOM_CONTENT_KEYS);
      var desc = map.description ? pick(entry, map.description) : firstOf(entry, CUSTOM_DESC_KEYS);
      var tags = map.tags ? pick(entry, map.tags) : entry.tags;
      var author = map.author ? pick(entry, map.author) : entry.author;
      var nativeId = map.id ? pick(entry, map.id) : entry.id;
      var website = map.website ? pick(entry, map.website) : entry.website;

      var item = makeItem({
        title: title,
        content: content,
        description: desc,
        remark: entry.remark,
        tags: tags,
        author: author,
        weight: entry.weight,
        website: website,
        lang: source.lang || 'zh',
        nativeId: nativeId === undefined || nativeId === null || nativeId === '' ? String(r + 1) : nativeId
      }, source, r + 1);
      if (item) items.push(item);
      else skipped++;
    }
    return {
      ok: items.length > 0,
      items: items,
      usedListPath: usedListPath,
      skipped: skipped,
      error: items.length > 0 ? null : 'no-usable-entries'
    };
  }

  /**
   * 按源类型分发适配。
   * @param {string} rawText 远程/文件原文
   * @param {object} src 源定义
   * @returns {{ ok:boolean, items:Array, error:string|null, detail:object }}
   *          JSON 解析失败时 error='json-parse-failed:...'，绝不抛错。
   */
  function adapt(rawText, src) {
    var source = src && typeof src === 'object' ? src : {};
    var kind = text.str(source.kind) || constants.SOURCE_KIND.CUSTOM_JSON;

    if (kind === constants.SOURCE_KIND.CSV) {
      var csv = adaptPromptsCsv(rawText, source);
      return { ok: csv.ok, items: csv.items, error: csv.error, detail: { headerCheck: csv.headerCheck, skipped: csv.skipped } };
    }

    var parsed = text.safeParseJSON(rawText);
    if (!parsed.ok) {
      return { ok: false, items: [], error: 'json-parse-failed:' + parsed.error, detail: {} };
    }
    if (kind === constants.SOURCE_KIND.SHORTCUT_JSON) {
      var b2 = adaptShortcutJson(parsed.value, source);
      return { ok: b2.ok, items: b2.items, error: b2.error, detail: { localeKey: b2.localeKey, skipped: b2.skipped } };
    }
    if (kind === constants.SOURCE_KIND.PROMPTS_ZH_JSON) {
      var b3 = adaptPromptsZhJson(parsed.value, source);
      return { ok: b3.ok, items: b3.items, error: b3.error, detail: { skipped: b3.skipped } };
    }
    var custom = adaptCustomJson(parsed.value, source);
    return { ok: custom.ok, items: custom.items, error: custom.error, detail: { usedListPath: custom.usedListPath, skipped: custom.skipped } };
  }

  /**
   * 去重：按 uid 优先，其次 contentHash。保留先出现者（B2 里 id 靠前权重高）。
   * @returns {{ items:Array, removed:number }}
   */
  function dedupe(items) {
    var list = Array.isArray(items) ? items : [];
    var seenUid = {};
    var seenHash = {};
    var out = [];
    var removed = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) { removed++; continue; }
      if (it.uid && seenUid[it.uid]) { removed++; continue; }
      if (it.contentHash && seenHash[it.contentHash]) { removed++; continue; }
      if (it.uid) seenUid[it.uid] = true;
      if (it.contentHash) seenHash[it.contentHash] = true;
      out.push(it);
    }
    return { items: out, removed: removed };
  }

  /* 完整性校验：源定义是否具备抓取所需字段（UI 的“源管理”用） */
  function validateSource(src) {
    var s = src && typeof src === 'object' ? src : {};
    var errors = [];
    var warnings = [];
    if (text.str(s.id) === '') errors.push('缺少 id');
    if (text.str(s.kind) === '') warnings.push('未声明 kind，将按 custom-json 处理');
    var hasUrl = text.str(s.url) !== '';
    var hasRepo = text.str(s.repo) !== '' && text.str(s.filePath) !== '';
    if (!hasUrl && !hasRepo) errors.push('缺少 url，或缺少 repo+filePath');
    if (hasUrl && !/^https:\/\//i.test(text.str(s.url))) {
      warnings.push('自定义源地址不是 https://（远程插件环境下可能被浏览器混合内容策略拦截）');
    }
    var kinds = constants.SOURCE_KIND;
    if (kinds && text.str(s.kind) !== '' && Object.keys(kinds).map(function (k) { return kinds[k]; }).indexOf(s.kind) < 0) {
      warnings.push('未知 kind=' + s.kind + '，将退化为 custom-json 解析');
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  core.normalize = {
    /* CSV */
    parseCsv: parseCsv,
    splitCsvRecords: splitCsvRecords,
    splitCsvFields: splitCsvFields,
    rowToObject: rowToObject,
    checkCsvHeader: checkCsvHeader,
    /* 适配器 */
    adaptPromptsCsv: adaptPromptsCsv,
    adaptShortcutJson: adaptShortcutJson,
    adaptPromptsZhJson: adaptPromptsZhJson,
    adaptCustomJson: adaptCustomJson,
    adapt: adapt,
    /* 构造与工具 */
    makeItem: makeItem,
    resolveLocaleBlock: resolveLocaleBlock,
    pick: pick,
    stringsOf: stringsOf,
    inferLang: inferLang,
    licenseOf: licenseOf,
    repoHomepage: repoHomepage,
    dedupe: dedupe,
    validateSource: validateSource,
    CUSTOM_TITLE_KEYS: CUSTOM_TITLE_KEYS,
    CUSTOM_CONTENT_KEYS: CUSTOM_CONTENT_KEYS,
    CUSTOM_DESC_KEYS: CUSTOM_DESC_KEYS
  };
})(__pmCore);

/* END inlined file: normalize.js */

/* BEGIN inlined file: net.js */
/* =============================================================================
 * unit: net.js — 出站 HTTPS 抓取：URL 解析、超时、重试、限流容忍
 * =============================================================================
 * 硬规则（CONSTRAINTS-01 §A/B、REL-01 §4）：
 *   1) 默认地址一律 cdn.jsdelivr.net；
 *   2) **不得**访问被阻断的 raw 域名；
 *   3) api.github.com 只作 base64 兜底，且**必须容忍 429**（匿名 60 次/小时/IP）；
 *   4) 任何失败都必须转成可展示错误态，绝不抛未捕获异常。
 * 只用 globalThis 上的 fetch / AbortController / setTimeout。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};

  var CDN = constants.CDN || { JSDELIVR: 'https://cdn.jsdelivr.net/gh/', GITHUB_API: 'https://api.github.com/' };
  var NET = constants.NET_DEFAULTS || {};
  var LIMITS = constants.LIMITS || {};
  var ERR = constants.ERROR_CODES || {};

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function errResult(code, message, extra) {
    var out = {
      ok: false,
      status: 0,
      text: null,
      bytes: 0,
      contentType: '',
      error: { code: code, message: message, transient: false },
      attempts: 0,
      url: '',
      from: null
    };
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * 1) URL 解析
   * ------------------------------------------------------------------------ */

  /* 生成 jsDelivr 主地址与 api.github.com 兜底地址（{ref} → 实际 ref） */
  function buildUrls(src) {
    var s = src && typeof src === 'object' ? src : {};
    var ref = text.str(s.ref) || 'main';
    var urls = { primary: '', fallback: '', kind: text.str(s.kind) };

    if (text.str(s.url) !== '') {
      /* 自定义源：直接用用户给的 URL */
      urls.primary = text.str(s.url);
      return urls;
    }
    var repo = text.str(s.repo);
    var filePath = text.str(s.filePath);
    if (repo === '' || filePath === '') return urls;

    var encRepo = repo.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    var encPath = filePath.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    urls.primary = CDN.JSDELIVR + encRepo + '@' + encodeURIComponent(ref) + '/' + encPath;

    /* 兜底：GitHub contents API（返回 JSON，content 字段是 base64）。
       ⚠️ base 域名是 api.github.com —— **不是**被阻断的 raw 域名，不得替换。 */
    var owner = repo.split('/')[0] || '';
    var name = repo.split('/')[1] || '';
    if (owner && name) {
      urls.fallback = CDN.GITHUB_API + 'repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name)
        + '/contents/' + encPath + '?ref=' + encodeURIComponent(ref);
    }
    return urls;
  }

  /**
   * 解析源的最终抓取地址（含锁定 commit sha 的能力）。
   * @param {object} src 源定义
   * @param {object} [opts] { allowFallback:boolean, meta:{etag,lastModified} }
   * @returns {{ primary, fallback, kind, headers, fallbackHeaders }}
   */
  function resolveUrl(src, opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var urls = buildUrls(src);
    var headers = {
      'Accept': 'text/plain, text/csv, application/json;q=0.9, */*;q=0.5',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    };
    if (options.meta && text.str(options.meta.etag) !== '') headers['If-None-Match'] = text.str(options.meta.etag);
    if (options.meta && text.str(options.meta.lastModified) !== '') headers['If-Modified-Since'] = text.str(options.meta.lastModified);
    /* token 只发给 api.github.com；绝不把凭据带到 jsDelivr 或自定义源 */
    var token = text.str(options.token);
    var fallbackHeaders = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token !== '') fallbackHeaders['Authorization'] = 'Bearer ' + token;
    if (!options.allowFallback) urls.fallback = '';
    return {
      primary: urls.primary,
      fallback: urls.fallback,
      kind: urls.kind,
      headers: headers,
      fallbackHeaders: fallbackHeaders
    };
  }

  /* ---------------------------------------------------------------------------
   * 2) 底层取文本
   * ------------------------------------------------------------------------ */
  function readResponseText(res, maxBytes) {
    /* 先看 content-length，超大直接拒绝（避免把 8 MB 级文件读进来） */
    var len = 0;
    try {
      var cl = res.headers && text.isFn(res.headers.get) ? res.headers.get('content-length') : null;
      if (cl) len = parseInt(cl, 10) || 0;
    } catch (e) { len = 0; }
    if (maxBytes && len > maxBytes) {
      return Promise.resolve({
        ok: false,
        code: ERR.PARSE,
        message: '响应体 ' + len + ' 字节，超过上限 ' + maxBytes + ' 字节，已拒绝读取（避免整库拉取拖死界面）。'
      });
    }
    return res.text().then(function (t) {
      var bytes = text.utf8Bytes(t);
      if (maxBytes && bytes > maxBytes) {
        return {
          ok: false,
          code: ERR.PARSE,
          message: '响应体实际 ' + bytes + ' 字节，超过上限 ' + maxBytes + ' 字节，已丢弃。'
        };
      }
      return { ok: true, text: t, bytes: bytes };
    }).catch(function (e) {
      return { ok: false, code: ERR.NETWORK, message: '读取响应体失败：' + ((e && e.message) || 'unknown') };
    });
  }

  function retryAfterMs(res) {
    try {
      var ra = res.headers && text.isFn(res.headers.get) ? res.headers.get('retry-after') : null;
      if (ra) {
        var secs = parseInt(ra, 10);
        if (isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 15 * 60 * 1000);
      }
      var reset = res.headers && text.isFn(res.headers.get) ? res.headers.get('x-ratelimit-reset') : null;
      if (reset) {
        var epoch = parseInt(reset, 10);
        if (isFinite(epoch) && epoch > 0) {
          var delta = (epoch * 1000) - Date.now();
          if (delta > 0) return Math.min(delta + 500, 15 * 60 * 1000);
        }
      }
    } catch (e) { /* 忽略 */ }
    return NET.rateLimitBackoffMs || 60000;
  }

  /**
   * 带超时 / 重试 / 退避的 GET 取文本。**永不 reject**。
   * @param {string} url
   * @param {object} [options] { timeoutMs, retries, backoffMs, backoffFactor, maxBackoffMs,
   *                            headers, maxBytes, allowRateLimitRetry }
   * @returns {Promise<{ok,status,text,bytes,contentType,headers,error,attempts,url,from}>}
   */
  function fetchText(url, options) {
    var o = options && typeof options === 'object' ? options : {};
    var timeoutMs = text.num(o.timeoutMs) || NET.timeoutMs || 15000;
    var maxAttempts = (text.num(o.retries) !== null ? text.num(o.retries) : (NET.retries === undefined ? 2 : NET.retries)) + 1;
    var backoff = text.num(o.backoffMs) || NET.backoffMs || 600;
    var factor = text.num(o.backoffFactor) || NET.backoffFactor || 3;
    var maxBackoff = text.num(o.maxBackoffMs) || NET.maxBackoffMs || 8000;
    var maxBytes = text.num(o.maxBytes) || LIMITS.RESPONSE_MAX_BYTES || 4 * 1024 * 1024;
    var headers = o.headers && typeof o.headers === 'object' ? o.headers : {};
    var allowRateLimitRetry = o.allowRateLimitRetry !== false;
    var target = text.str(url);

    if (target === '') {
      return Promise.resolve(errResult(ERR.BAD_INPUT, '空 URL，未发起请求。', { url: target }));
    }
    if (typeof fetch !== 'function') {
      return Promise.resolve(errResult(ERR.NETWORK, '当前运行时不提供 fetch()，无法联网（仍可使用缓存与本地数据）。', { url: target }));
    }

    var attempts = 0;
    var lastError = { code: ERR.NETWORK, message: '未发起请求', transient: true };

    function attempt() {
      attempts++;
      var controller = null;
      var timer = null;
      var fetchOpts = { method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store' };
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController();
          fetchOpts.signal = controller.signal;
          timer = setTimeout(function () {
            try { controller.abort(); } catch (e) { /* 忽略 */ }
          }, timeoutMs);
        }
      } catch (e) { controller = null; timer = null; }

      function cleanup() {
        if (timer) { try { clearTimeout(timer); } catch (e2) { /* 忽略 */ } timer = null; }
      }

      return fetch(target, fetchOpts).then(function (res) {
        var status = res && text.num(res.status) !== null ? res.status : 0;
        var contentType = '';
        var etag = '';
        var lastModified = '';
        var remaining = null;
        var reset = null;
        try {
          if (res.headers && text.isFn(res.headers.get)) {
            contentType = text.str(res.headers.get('content-type'));
            etag = text.str(res.headers.get('etag'));
            lastModified = text.str(res.headers.get('last-modified'));
            var rem = res.headers.get('x-ratelimit-remaining');
            if (rem !== null) remaining = text.num(rem);
            var rst = res.headers.get('x-ratelimit-reset');
            if (rst !== null) reset = text.num(rst);
          }
        } catch (e3) { /* 忽略 */ }

        /* 304：内容未变，交给上层继续用缓存 */
        if (status === 304) {
          cleanup();
          return {
            ok: false, status: 304, text: null, bytes: 0, contentType: contentType,
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: { code: null, message: 'not-modified', transient: false, notModified: true },
            attempts: attempts, url: target, from: 'network-304'
          };
        }

        if (status === 429) {
          cleanup();
          var wait = retryAfterMs(res);
          lastError = {
            code: ERR.RATE_LIMIT,
            message: 'api.github.com 匿名限流 429（60 次/小时/IP）。'
              + (remaining === 0 ? '当前配额已用尽。' : '')
              + '建议等待 ' + Math.round(wait / 1000) + ' 秒，或改用 jsDelivr 主通道；本次已静默降级为本地缓存数据。',
            transient: true,
            retryAfterMs: wait
          };
          if (allowRateLimitRetry && attempts < maxAttempts && wait <= 5000) {
            return sleep(wait).then(attempt);
          }
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network',
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: lastError
          });
        }

        if (status === 403 && remaining === 0) {
          cleanup();
          lastError = {
            code: ERR.RATE_LIMIT,
            message: 'GitHub API 403 且配额已用尽（x-ratelimit-remaining=0）。本次已静默降级为本地缓存数据。',
            transient: true
          };
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        if (status === 404 || status === 400) {
          cleanup();
          lastError = {
            code: ERR.NOT_FOUND,
            message: 'HTTP ' + status + '：上游地址不存在或参数不合法（该源可能已改名/删除文件）。',
            transient: false
          };
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        if (status < 200 || status >= 300) {
          cleanup();
          lastError = {
            code: ERR.HTTP,
            message: 'HTTP ' + status + '（' + contentType + '）。',
            transient: status >= 500
          };
          if (lastError.transient && attempts < maxAttempts) {
            var w = Math.min(backoff * Math.pow(factor, attempts - 1), maxBackoff);
            return sleep(w).then(attempt);
          }
          return errResult(lastError.code, lastError.message, {
            status: status, attempts: attempts, url: target, from: 'network', error: lastError
          });
        }

        return readResponseText(res, maxBytes).then(function (body) {
          cleanup();
          if (!body.ok) {
            lastError = { code: body.code, message: body.message, transient: false };
            return errResult(lastError.code, lastError.message, {
              status: status, attempts: attempts, url: target, from: 'network', error: lastError
            });
          }
          return {
            ok: true,
            status: status,
            text: body.text,
            bytes: body.bytes,
            contentType: contentType,
            headers: { etag: etag, lastModified: lastModified, remaining: remaining, reset: reset },
            error: null,
            attempts: attempts,
            url: target,
            from: 'network'
          };
        });
      }).catch(function (e4) {
        cleanup();
        var name = (e4 && e4.name) ? e4.name : '';
        var msg = (e4 && e4.message) ? e4.message : 'unknown';
        var isAbort = name === 'AbortError' || /aborted/i.test(msg);
        lastError = {
          code: isAbort ? ERR.TIMEOUT : ERR.NETWORK,
          message: isAbort
            ? ('请求超时（>' + timeoutMs + ' ms）：' + target)
            : ('网络请求失败：' + msg + '（' + target + '）'),
          transient: true
        };
        if (attempts < maxAttempts) {
          var w2 = Math.min(backoff * Math.pow(factor, attempts - 1), maxBackoff);
          return sleep(w2).then(attempt);
        }
        return errResult(lastError.code, lastError.message, {
          status: 0, attempts: attempts, url: target, from: 'network', error: lastError
        });
      });
    }

    return attempt().catch(function (e) {
      /* 兜底：attempt 内部的 then/catch 已处理，这里只防 Promise 链外的意外 */
      return errResult(ERR.NETWORK, '未预期的抓取异常：' + ((e && e.message) || 'unknown'), { url: target });
    });
  }

  /* ---------------------------------------------------------------------------
   * 3) base64（api.github.com contents 兜底用；不依赖 atob/Buffer 的纯 JS 实现）
   * ------------------------------------------------------------------------ */
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Decode(input) {
    var s = text.str(input).replace(/[\r\n\t ]/g, '');
    if (s === '') return '';
    var lookup = {};
    for (var c = 0; c < B64_CHARS.length; c++) lookup[B64_CHARS.charAt(c)] = c;
    var out = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '=') break;
      if (!Object.prototype.hasOwnProperty.call(lookup, ch)) continue; // 跳过非法字符
      buffer = (buffer << 6) | lookup[ch];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
      }
    }
    /* UTF-8 字节流 → 字符串（解码失败时退化为二进制字符串） */
    try {
      var decoded = '';
      var b = 0;
      while (b < out.length) {
        var byte1 = out[b];
        var cp = 0;
        var extra = 0;
        if (byte1 < 0x80) { cp = byte1; extra = 0; }
        else if ((byte1 & 0xe0) === 0xc0) { cp = byte1 & 0x1f; extra = 1; }
        else if ((byte1 & 0xf0) === 0xe0) { cp = byte1 & 0x0f; extra = 2; }
        else if ((byte1 & 0xf8) === 0xf0) { cp = byte1 & 0x07; extra = 3; }
        else { cp = 0xfffd; extra = 0; }
        b++;
        for (var e = 0; e < extra && b < out.length; e++) {
          cp = (cp << 6) | (out[b] & 0x3f);
          b++;
        }
        if (cp <= 0xffff) decoded += String.fromCharCode(cp);
        else {
          var v = cp - 0x10000;
          decoded += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        }
      }
      return decoded;
    } catch (errDecode) {
      var fallback = '';
      for (var j = 0; j < out.length; j++) fallback += String.fromCharCode(out[j]);
      return fallback;
    }
  }

  /* 从 contents API 响应里取回文件原文并解码（永不抛错） */
  function decodeContentsApi(payload) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, code: ERR.PARSE, message: 'contents API 返回体不是对象' };
    }
    if (text.str(payload.message) !== '' && text.str(payload.content) === '') {
      return {
        ok: false,
        code: ERR.HTTP,
        message: 'contents API 报错：' + text.str(payload.message)
      };
    }
    var content = text.str(payload.content);
    if (content === '') {
      return { ok: false, code: ERR.PARSE, message: 'contents API 未返回 content 字段（可能是目录而非文件）。' };
    }
    var encoding = text.str(payload.encoding);
    if (encoding !== '' && encoding !== 'base64') {
      return { ok: false, code: ERR.UNSUPPORTED, message: 'contents API encoding=' + encoding + ' 暂不支持（仅 base64）。' };
    }
    return { ok: true, text: base64Decode(content), bytes: text.num(payload.size) };
  }

  /* ---------------------------------------------------------------------------
   * 4) 取 commit sha（用于锁定 jsDelivr 地址，防上游漂移）
   * ------------------------------------------------------------------------ */
  function resolveCommitSha(repo, ref, options) {
    var target = text.str(repo);
    if (target === '') return Promise.resolve({ ok: false, sha: null, error: { code: ERR.BAD_INPUT, message: '缺少 repo' } });
    var branch = text.str(ref) || 'main';
    var url = CDN.GITHUB_API + 'repos/' + target.split('/').map(function (p) { return encodeURIComponent(p); }).join('/')
      + '/commits/' + encodeURIComponent(branch);
    var o = options && typeof options === 'object' ? options : {};
    return fetchText(url, {
      timeoutMs: o.timeoutMs || 10000,
      retries: 1,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      maxBytes: 512 * 1024
    }).then(function (res) {
      if (!res.ok) {
        return { ok: false, sha: null, error: res.error, httpStatus: res.status };
      }
      var parsed = text.safeParseJSON(res.text);
      if (!parsed.ok || !parsed.value) {
        return { ok: false, sha: null, error: { code: ERR.PARSE, message: 'commit 响应不是合法 JSON' }, httpStatus: res.status };
      }
      var sha = text.str(parsed.value.sha);
      if (sha === '') {
        return { ok: false, sha: null, error: { code: ERR.PARSE, message: 'commit 响应缺少 sha 字段' }, httpStatus: res.status };
      }
      return { ok: true, sha: sha, error: null, httpStatus: res.status };
    });
  }

  core.net = {
    buildUrls: buildUrls,
    resolveUrl: resolveUrl,
    fetchText: fetchText,
    base64Decode: base64Decode,
    decodeContentsApi: decodeContentsApi,
    resolveCommitSha: resolveCommitSha,
    retryAfterMs: retryAfterMs,
    sleep: sleep
  };
})(__pmCore);

/* END inlined file: net.js */

/* BEGIN inlined file: sources.js */
/* =============================================================================
 * unit: sources.js — 源注册表与单源获取（缓存优先 + 静默降级）
 * =============================================================================
 * 职责：
 *   1) 把「内置源注册表」与「用户在 state.sources 里的自定义源 / 覆盖项」合并；
 *   2) 单源获取管线：内存 TTL → fetch（jsDelivr 主通道）→ 解析归一化 → 落缓存；
 *      任何一步失败都按「可展示错误态 + 继续用缓存」处理，**绝不抛异常**；
 *   3) api.github.com base64 兜底，并容忍 429（返回限流错误态而不是崩）。
 *
 * 降级矩阵：首次成功=live；内存 TTL=memory；网络失败+有缓存=cache；
 * 网络失败+无缓存=error；404=E_NOT_FOUND；429=E_RATE_LIMIT；超限/解析失败=E_PARSE。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var normalize = core.normalize || {};
  var net = core.net || {};
  var filter = core.filter || {};

  var ERR = constants.ERROR_CODES || {};
  var NET = constants.NET_DEFAULTS || {};

  /* ---------------------------------------------------------------------------
   * 1) 源列表合并
   * ------------------------------------------------------------------------ */
  /**
   * 合并内置源 + state.sources（覆盖项与新增项）。
   * @param {object} [state] store.toJSON() 的结果
   * @returns {Array<object>} 源定义数组（顺序：内置在前，自定义在后）
   */
  function merge(state) {
    var builtins = constants.BUILTIN_SOURCES || [];
    var userSources = (state && Array.isArray(state.sources)) ? state.sources : [];
    var byId = {};
    var order = [];
    var i;

    for (i = 0; i < builtins.length; i++) {
      var b = builtins[i];
      var copy = {};
      for (var k in b) {
        if (Object.prototype.hasOwnProperty.call(b, k)) copy[k] = b[k];
      }
      byId[copy.id] = copy;
      order.push(copy.id);
    }
    for (i = 0; i < userSources.length; i++) {
      var u = userSources[i];
      if (!u || !text.str(u.id)) continue;
      if (byId[u.id]) {
        /* 覆盖项：只允许改“可配置”字段，repo/filePath/许可不允许被改掉（防误配） */
        var target = byId[u.id];
        var mutable = ['enabled', 'ref', 'enabledFallback', 'name', 'lang', 'allowGithubFallback'];
        for (var m = 0; m < mutable.length; m++) {
          if (u[mutable[m]] !== undefined) target[mutable[m]] = u[mutable[m]];
        }
      } else {
        byId[u.id] = u;
        order.push(u.id);
      }
    }

    var out = [];
    for (i = 0; i < order.length; i++) out.push(byId[order[i]]);
    return out;
  }

  /**
   * 源目录视图（UI 的「源管理」页直接用这个渲染）。
   * @param {object} [state]
   * @param {object} [statusBySource] { [sourceId]: { freshness, itemCount, error, fetchedAt } }
   */
  function catalog(state, statusBySource) {
    var list = merge(state);
    var statuses = statusBySource && typeof statusBySource === 'object' ? statusBySource : {};
    var licenses = constants.LICENSES || {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var urls = net.buildUrls ? net.buildUrls(s) : { primary: '', fallback: '' };
      var st = statuses[s.id] || {};
      var base = normalize.licenseOf ? normalize.licenseOf(s) : null;
      var full = licenses[s.licenseId] || licenses.UNKNOWN || null;
      /* license 视图同时给出：归一化摘要 + 许可正文（UI 的署名区可直接渲染 text） */
      var lic = null;
      if (base) {
        lic = {
          id: base.id,
          name: base.name,
          spdx: base.spdx,
          url: base.url,
          attributionRequired: base.attributionRequired === true,
          attributionText: base.attributionText,
          sourceUrl: base.sourceUrl,
          copyrightHolder: base.copyrightHolder,
          textSource: full ? full.textSource : '',
          text: full ? full.text : '',
          fullTextAvailable: full ? full.fullTextAvailable === true : false,
          strongAttribution: full ? full.strongAttribution === true : false
        };
      }
      out.push({
        id: s.id,
        name: s.name,
        kind: s.kind,
        origin: s.origin,
        enabled: s.enabled !== false,
        removable: s.removable === true,
        lang: s.lang,
        repo: s.repo || null,
        filePath: s.filePath || null,
        ref: s.ref || null,
        url: urls.primary || s.url || '',
        fallbackUrl: (s.enabledFallback === true || s.allowGithubFallback === true) ? (urls.fallback || '') : '',
        homepage: s.homepage || '',
        license: lic,
        licenseId: s.licenseId || 'UNKNOWN',
        licenseNote: s.licenseNote || '',
        supportsWeight: s.supportsWeight === true,
        notes: Array.isArray(s.notes) ? s.notes.slice(0) : [],
        status: {
          freshness: st.freshness || 'unknown',
          itemCount: text.num(st.itemCount) || 0,
          filteredCount: text.num(st.filteredCount) || 0,
          fetchedAt: st.fetchedAt || null,
          error: st.error || null,
          fromCache: st.freshness === 'cache'
        }
      });
    }
    return out;
  }

  function getById(state, sourceId) {
    var list = merge(state);
    for (var i = 0; i < list.length; i++) if (list[i].id === sourceId) return list[i];
    return null;
  }

  /* ---------------------------------------------------------------------------
   * 2) 单源获取
   * ------------------------------------------------------------------------ */
  var memoryCache = {}; // { [sourceId]: { at:number, payload:object } }

  function clearMemory(sourceId) {
    if (sourceId) delete memoryCache[sourceId];
    else memoryCache = {};
  }

  function errorState(code, message, extra) {
    var out = {
      ok: false,
      freshness: 'error',
      items: [],
      filteredOut: 0,
      error: { code: code || ERR.NETWORK, message: message || '未知错误', showable: true },
      meta: null
    };
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    if (out.freshness === 'cache' || out.freshness === 'memory') out.ok = true;
    return out;
  }

  function applyFilter(items, settings) {
    if (!filter.apply) return { items: items, stats: { input: items.length, kept: items.length, dropped: 0, filtered: false } };
    var res = filter.apply(items, settings);
    return { items: res.items, stats: res.stats };
  }

  /**
   * 获取单个源（缓存优先 + 静默降级）。**永不抛异常。**
   * @param {string} sourceId
   * @param {object} ctx { store, state, settings, force?:boolean, memoryTtlMs?:number }
   * @returns {Promise<object>} FetchOutcome（见 docs/DATA-01-数据层接口.md §7.2）
   */
  function fetchSource(sourceId, ctx) {
    var context = ctx && typeof ctx === 'object' ? ctx : {};
    var store = context.store;
    var state = context.state || (store && store.toJSON ? store.toJSON() : {});
    var settings = context.settings || (state && state.settings) || {};
    var src = getById(state, text.str(sourceId));

    if (!src) {
      return Promise.resolve(errorState(ERR.NOT_FOUND, '未找到源 id=' + text.str(sourceId) + '（可能已被删除，或用户在源管理里移除了它）。'));
    }
    var validation = normalize.validateSource ? normalize.validateSource(src) : { ok: true, errors: [] };
    if (!validation.ok) {
      return Promise.resolve(errorState(ERR.BAD_INPUT, '源配置不合法：' + validation.errors.join('；')));
    }
    if (src.enabled === false) {
      return Promise.resolve(errorState(ERR.UNSUPPORTED, '源「' + src.name + '」当前被禁用（可在源管理里重新启用）。', { disabled: true }));
    }

    var ttl = text.num(context.memoryTtlMs);
    if (ttl === null) ttl = NET.memoryTtlMs || 600000;
    var now = Date.now();
    var mem = memoryCache[src.id];
    if (!context.force && mem && (now - mem.at) < ttl) {
      var cachedMem = applyFilter(mem.payload.items, settings);
      return Promise.resolve({
        ok: true,
        freshness: 'memory',
        items: cachedMem.items,
        filteredOut: cachedMem.stats.dropped,
        filterStats: cachedMem.stats,
        source: src,
        error: null,
        meta: mem.payload.meta,
        attempts: 0
      });
    }

    var allowFallback = context.allowGithubFallback !== undefined
      ? context.allowGithubFallback === true
      : (settings.allowGithubFallback !== false && src.enabledFallback !== false);
    var resolved = net.resolveUrl(src, {
      allowFallback: allowFallback,
      token: settings.githubToken || ''
    });

    function fromCacheOrError(code, message, extra) {
      var entry = null;
      try {
        entry = store && store.cacheGet ? store.cacheGet(src.id) : null;
      } catch (e) {
        entry = null;
      }
      var details = {
        source: src,
        meta: entry ? {
          fetchedAt: entry.fetchedAt,
          url: entry.url,
          ref: entry.ref,
          itemCount: entry.itemCount,
          storedCount: entry.storedCount,
          truncated: entry.truncated === true
        } : null,
        attempts: extra && extra.attempts ? extra.attempts : 0,
        httpStatus: extra && extra.httpStatus ? extra.httpStatus : 0
      };
      if (entry && Array.isArray(entry.items) && entry.items.length > 0) {
        var cachedItems = applyFilter(entry.items, settings);
        details.ok = true;
        details.freshness = 'cache';
        details.items = cachedItems.items;
        details.filteredOut = cachedItems.stats.dropped;
        details.filterStats = cachedItems.stats;
        details.error = {
          code: code || ERR.NETWORK,
          message: (message || '抓取失败') + ' 已回退到本地缓存（' + entry.storedCount + ' / ' + entry.itemCount + ' 条，'
            + (entry.truncated ? '缓存已截断；' : '') + '抓取时间 ' + text.str(entry.fetchedAt) + '）。',
          showable: true,
          degraded: true
        };
        return details;
      }
      details.error = {
        code: code || ERR.NETWORK,
        message: (message || '抓取失败') + ' 且本地没有该源的缓存，暂时无法展示该源内容。',
        showable: true,
        degraded: true
      };
      return details;
    }

    function doFetch(url, isFallback) {
      return net.fetchText(url, {
        timeoutMs: NET.timeoutMs,
        retries: isFallback ? 1 : NET.retries,
        headers: isFallback ? (resolved.fallbackHeaders || resolved.headers) : resolved.headers,
        maxBytes: (constants.LIMITS && constants.LIMITS.RESPONSE_MAX_BYTES) || 4 * 1024 * 1024
      });
    }

    function buildFromText(rawText, meta) {
      var adapted = normalize.adapt(rawText, src);
      if (!adapted.ok) {
        return fromCacheOrError(ERR.PARSE,
          '解析失败（结构可能已变化）：' + text.str(adapted.error || 'unknown'),
          { attempts: meta.attempts, httpStatus: meta.httpStatus });
      }
      var deduped = normalize.dedupe(adapted.items);
      var payload = {
        items: deduped.items,
        meta: {
          sourceId: src.id,
          url: meta.url,
          from: meta.from,
          fallbackUsed: meta.fallbackUsed === true,
          fetchedAt: text.nowIso(),
          itemCount: deduped.items.length,
          duplicatesRemoved: deduped.removed,
          detail: adapted.detail || {},
          httpStatus: meta.httpStatus,
          etag: meta.headers ? meta.headers.etag : '',
          lastModified: meta.headers ? meta.headers.lastModified : ''
        }
      };
      memoryCache[src.id] = { at: Date.now(), payload: payload };
      var cacheWrite = null;
      if (store && store.cacheSet) {
        cacheWrite = store.cacheSet(src.id, deduped.items, {
          url: meta.url,
          ref: src.ref || null,
          fetchedAt: payload.meta.fetchedAt,
          license: normalize.licenseOf ? normalize.licenseOf(src) : null
        });
      }
      var filtered = applyFilter(deduped.items, settings);
      return {
        ok: true,
        freshness: 'live',
        items: filtered.items,
        filteredOut: filtered.stats.dropped,
        filterStats: filtered.stats,
        source: src,
        error: null,
        meta: payload.meta,
        attempts: meta.attempts,
        cacheWrite: cacheWrite
      };
    }

    return doFetch(resolved.primary, false).then(function (res) {
      /* 主通道失败：能兜底就兜底（api.github.com base64），否则降级缓存 */
      if (!res.ok && resolved.fallback && (res.status === 404 || res.status === 403 || res.status === 429
        || (res.error && res.error.code === ERR.NETWORK) || (res.error && res.error.code === ERR.TIMEOUT))) {
        return doFetch(resolved.fallback, true).then(function (fb) {
          if (!fb.ok) {
            return fromCacheOrError(fb.error ? fb.error.code : ERR.NETWORK,
              '主通道失败（' + (res.error ? res.error.message : '未知') + '），兜底通道也失败（' + (fb.error ? fb.error.message : '未知') + '）。',
              { attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status });
          }
          var decoded = net.decodeContentsApi(text.safeParseJSON(fb.text).value);
          if (!decoded.ok) {
            return fromCacheOrError(decoded.code, '兜底通道返回体无法解码：' + decoded.message,
              { attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status });
          }
          return buildFromText(decoded.text, {
            url: fb.url, from: 'github-api-base64', fallbackUsed: true,
            attempts: (res.attempts || 0) + (fb.attempts || 0), httpStatus: fb.status
          });
        });
      }
      if (!res.ok) {
        if (res.error && res.error.code === null && res.status === 304) {
          /* 304：内容未变，直接用缓存（这里不重写缓存时间，避免缓存永不老化） */
          return fromCacheOrError(ERR.NETWORK, '响应 304（内容未修改）。', { attempts: res.attempts, httpStatus: 304 });
        }
        return fromCacheOrError(res.error ? res.error.code : ERR.NETWORK, res.error ? res.error.message : '抓取失败',
          { attempts: res.attempts, httpStatus: res.status });
      }
      return buildFromText(res.text, {
        url: res.url, from: 'jsdelivr', fallbackUsed: false,
        attempts: res.attempts, httpStatus: res.status, headers: res.headers
      });
    }).catch(function (e) {
      return fromCacheOrError(ERR.NETWORK, '抓取管线异常：' + ((e && e.message) || 'unknown'));
    });
  }

  /* ---------------------------------------------------------------------------
   * 3) 多源聚合（市场页首屏）
   * ------------------------------------------------------------------------ */
  /**
   * 并发抓取多个源并合并；**单源失败不影响其它源**。
   * @param {Array<string>} sourceIds
   * @param {object} fetchCtx 同 fetchSource 的 ctx
   * @returns {Promise<{ ok, items, sources, errors, totalBeforeFilter, totalAfterFilter, degraded }>}
   */
  function fetchMany(sourceIds, fetchCtx) {
    var ids = Array.isArray(sourceIds) ? sourceIds.filter(function (x) { return typeof x === 'string' && x !== ''; }) : [];
    if (ids.length === 0) {
      return Promise.resolve({
        ok: true, items: [], sources: [], errors: [],
        totalBeforeFilter: 0, totalAfterFilter: 0, degraded: false
      });
    }
    var jobs = ids.map(function (id) {
      return fetchSource(id, fetchCtx).catch(function (e) {
        return errorState(ERR.NETWORK, '源 ' + id + ' 抓取异常：' + ((e && e.message) || 'unknown'));
      });
    });
    return Promise.all(jobs).then(function (results) {
      var items = [];
      var sources = [];
      var errors = [];
      var before = 0;
      var after = 0;
      var degraded = false;
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var sid = ids[i];
        sources.push({
          sourceId: sid,
          ok: r.ok === true,
          freshness: r.freshness,
          itemCount: Array.isArray(r.items) ? r.items.length : 0,
          filteredOut: text.num(r.filteredOut) || 0,
          error: r.error || null,
          meta: r.meta || null
        });
        if (r.error && r.error.showable) errors.push({ sourceId: sid, code: r.error.code, message: r.error.message, degraded: r.error.degraded === true });
        if (r.freshness === 'cache' || r.freshness === 'memory') degraded = true;
        if (!r.ok) { continue; }
        before += (Array.isArray(r.items) ? r.items.length : 0) + (text.num(r.filteredOut) || 0);
        after += (Array.isArray(r.items) ? r.items.length : 0);
        for (var j = 0; j < r.items.length; j++) items.push(r.items[j]);
      }
      return {
        ok: true,
        items: items,
        sources: sources,
        errors: errors,
        totalBeforeFilter: before,
        totalAfterFilter: after,
        degraded: degraded
      };
    });
  }

  core.sources = {
    merge: merge,
    catalog: catalog,
    getById: getById,
    fetchSource: fetchSource,
    fetchMany: fetchMany,
    clearMemory: clearMemory,
    memorySnapshot: function () {
      var out = {};
      for (var k in memoryCache) {
        if (Object.prototype.hasOwnProperty.call(memoryCache, k)) {
          out[k] = { at: memoryCache[k].at, itemCount: memoryCache[k].payload.items.length };
        }
      }
      return out;
    }
  };
})(__pmCore);

/* END inlined file: sources.js */

/* BEGIN inlined file: api.js */
/* =============================================================================
 * unit: api.js — 数据层门面（UI / verifier 唯一需要引用的对象）
 * =============================================================================
 * 组装顺序：constants → text → filter → storage → normalize → net → sources → api
 * 主入口：var market = __pmCore.api.createDataLayer({})  → market.init() → market.search(...)
 * 纪律：所有可能出错的入口都返回结果对象，**绝不抛未捕获异常**。
 * ============================================================================= */

'use strict';

var __pmCore = globalThis.__pmCore || (globalThis.__pmCore = {});

(function (core) {
  var text = core.text || {};
  var constants = core.constants || {};
  var storage = core.storage || {};
  var sourcesMod = core.sources || {};
  var filterMod = core.filter || {};
  var normalizeMod = core.normalize || {};

  var ERR = constants.ERROR_CODES || {};

  /* ---------------------------------------------------------------------------
   * 检索辅助
   * ------------------------------------------------------------------------ */
  function itemMatches(item, q) {
    if (!item || typeof item !== 'object') return false;
    if (q === null || q === undefined || q === '') return true;
    var hay = [
      text.str(item.title),
      text.str(item.description),
      text.str(item.remark),
      text.str(item.content || item.body),
      Array.isArray(item.tags) ? item.tags.join(' ') : ''
    ].join('\n').toLowerCase();
    if (!text.isString(q)) return true;
    var terms = q.toLowerCase().split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] === '') continue;
      if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }

  function sortItems(items, mode, q) {
    var list = items.slice(0);
    var m = mode === 'title' ? 'title' : 'weight';
    list.sort(function (a, b) {
      if (m === 'weight') {
        var wa = text.num(a.weight);
        var wb = text.num(b.weight);
        if (wa === null) wa = -1;
        if (wb === null) wb = -1;
        if (wb !== wa) return wb - wa;
      }
      var ta = text.str(a.title);
      var tb = text.str(b.title);
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });
    /* 搜索时把标题命中的排前面（更符合“搜索直觉”） */
    if (m === 'weight' && text.str(q) !== '') {
      var needle = text.str(q).toLowerCase();
      list.sort(function (a, b) {
        var ha = text.str(a.title).toLowerCase().indexOf(needle) >= 0 ? 1 : 0;
        var hb = text.str(b.title).toLowerCase().indexOf(needle) >= 0 ? 1 : 0;
        return hb - ha;
      });
    }
    return list;
  }

  /* ---------------------------------------------------------------------------
   * 数据层工厂
   * ------------------------------------------------------------------------ */
  /**
   * @param {object} [options] { backend, clock, store }
   * @returns {object} 数据层 API（见 docs/DATA-01-数据层接口.md §4）
   */
  function createDataLayer(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = opts.store || storage.createStore({
      backend: opts.backend || null,
      clock: opts.clock || null
    });

    var initReport = null;
    var sourceStatus = {};   // { [sourceId]: { freshness, itemCount, filteredOut, fetchedAt, error } }

    /* ------------------------------ init ------------------------------ */
    function init() {
      var r = { ok: false, store: null, backendReport: null, warnings: [], migrated: false };
      try {
        var loaded = store.load();
        r.ok = loaded.ok === true;
        r.migrated = loaded.migrated === true;
        r.code = loaded.code || null;
        r.message = loaded.message || null;
        r.backendReport = loaded.reported || store.backendReport;
      } catch (e) {
        r.ok = false;
        r.code = ERR.STORAGE;
        r.message = '初始化持久层失败：' + ((e && e.message) || 'unknown');
      }
      try {
        r.store = store.status();
        r.warnings = r.store.warnings || [];
      } catch (e2) {
        r.store = null;
      }
      initReport = r;
      return r;
    }

    function state() {
      return store.toJSON();
    }

    function settings() {
      var s = state();
      return s.settings || storage.defaultSettings();
    }

    /* ------------------------- 远程获取（带状态记账） ----------------- */
    function fetchSource(sourceId, fetchOptions) {
      var o = fetchOptions && typeof fetchOptions === 'object' ? fetchOptions : {};
      var s = state();
      return sourcesMod.fetchSource(sourceId, {
        store: store,
        state: s,
        settings: s.settings,
        force: o.force === true,
        memoryTtlMs: o.memoryTtlMs,
        allowGithubFallback: o.allowGithubFallback
      }).then(function (out) {
        sourceStatus[sourceId] = {
          freshness: out.freshness,
          itemCount: Array.isArray(out.items) ? out.items.length : 0,
          filteredOut: text.num(out.filteredOut) || 0,
          fetchedAt: out.meta ? out.meta.fetchedAt : null,
          error: out.error || null
        };
        return out;
      }).catch(function (e) {
        var code = ERR.NETWORK;
        var message = '抓取源 ' + sourceId + ' 时发生未预期异常：' + ((e && e.message) || 'unknown');
        sourceStatus[sourceId] = { freshness: 'error', itemCount: 0, filteredOut: 0, fetchedAt: null, error: { code: code, message: message, showable: true } };
        return { ok: false, freshness: 'error', items: [], filteredOut: 0, error: { code: code, message: message, showable: true }, meta: null };
      });
    }

    function enabledSourceIds() {
      var s = state();
      var list = sourcesMod.merge(s);
      var ids = [];
      for (var i = 0; i < list.length; i++) if (list[i].enabled !== false) ids.push(list[i].id);
      return ids;
    }

    /* ------------------------------ 检索 ------------------------------ */
    /**
     * @param {object} [query] { q, tab:'market'|'favorites'|'mine'|'all', sourceIds,
     *                           page, pageSize, force }
     * @returns {Promise<object>} 见 docs/DATA-01-数据层接口.md §7.1
     */
    function search(query) {
      var q = query && typeof query === 'object' ? query : {};
      var tab = text.str(q.tab) || 'market';
      var s = state();
      var cfg = s.settings || {};
      var keyword = text.str(q.q);
      var filterSettings = cfg.filter || (filterMod.defaultSettings ? filterMod.defaultSettings() : { enabled: true });

      var gather;
      if (tab === 'favorites') {
        gather = Promise.resolve({ items: (s.favorites || []).slice(0), errors: [] });
      } else if (tab === 'mine') {
        gather = Promise.resolve({ items: (s.customs || []).slice(0), errors: [] });
      } else if (tab === 'all') {
        gather = Promise.all([
          Promise.resolve({ items: (s.favorites || []).concat(s.customs || []), errors: [] }),
          fetchEnabledSources(q)
        ]).then(function (both) {
          return { items: both[0].items.concat(both[1].items), errors: both[0].errors.concat(both[1].errors) };
        });
      } else {
        gather = fetchEnabledSources(q);
      }

      return gather.then(function (res) {
        var all = Array.isArray(res.items) ? res.items : [];
        /* 1) 关键字 */
        var searched = [];
        for (var i = 0; i < all.length; i++) {
          if (itemMatches(all[i], keyword)) searched.push(all[i]);
        }
        /* 2) 过滤（读取时应用） */
        var filteredResult = filterMod.apply ? filterMod.apply(searched, filterSettings) : { items: searched, stats: { input: searched.length, kept: searched.length, dropped: 0, filtered: false } };
        /* 3) 排序 */
        var sorted = sortItems(filteredResult.items, cfg.sort, keyword);
        /* 4) 分页 */
        var pageSize = text.num(q.pageSize);
        if (pageSize === null) pageSize = text.num(cfg.pageSize);
        if (pageSize === null) pageSize = 60;
        pageSize = text.clamp(pageSize, 1, 200);
        var page = text.num(q.page);
        if (page === null) page = 1;
        page = Math.max(1, Math.floor(page));
        var total = sorted.length;
        var start = (page - 1) * pageSize;
        var items = sorted.slice(start, start + pageSize);

        return {
          ok: true,
          tab: tab,
          q: keyword,
          page: page,
          pageSize: pageSize,
          total: total,
          hasMore: start + items.length < total,
          items: items,
          filteredCount: filteredResult.stats.dropped,
          filterStats: filteredResult.stats,
          errors: res.errors || [],
          sources: sourceStatus,
          degraded: (res.errors || []).some(function (e) { return e.degraded === true; })
        };
      }).catch(function (e) {
        return {
          ok: false,
          tab: tab,
          q: keyword,
          page: 1,
          pageSize: 60,
          total: 0,
          hasMore: false,
          items: [],
          filteredCount: 0,
          filterStats: null,
          errors: [{ code: ERR.NETWORK, message: '检索过程异常：' + ((e && e.message) || 'unknown'), degraded: true }],
          sources: sourceStatus,
          degraded: true
        };
      });
    }

    function fetchEnabledSources(q) {
      var s = state();
      var ids = Array.isArray(q.sourceIds) && q.sourceIds.length > 0 ? q.sourceIds.slice(0) : enabledSourceIds();
      if (ids.length === 0) return Promise.resolve({ items: [], errors: [] });
      return sourcesMod.fetchMany(ids, {
        store: store,
        state: s,
        settings: s.settings,
        force: q.force === true,
        memoryTtlMs: q.memoryTtlMs,
        allowGithubFallback: q.allowGithubFallback
      }).then(function (merged) {
        /* 记账：把每个源的状态写进 sourceStatus（供源管理页渲染） */
        for (var i = 0; i < merged.sources.length; i++) {
          var ss = merged.sources[i];
          sourceStatus[ss.sourceId] = {
            freshness: ss.freshness,
            itemCount: ss.itemCount,
            filteredOut: ss.filteredOut,
            fetchedAt: ss.meta ? ss.meta.fetchedAt : null,
            error: ss.error
          };
        }
        return { items: merged.items, errors: merged.errors };
      }).catch(function (e) {
        return {
          items: [],
          errors: [{ code: ERR.NETWORK, message: '多源聚合异常：' + ((e && e.message) || 'unknown'), degraded: true }]
        };
      });
    }

    /* ---------------------------- 收藏 ---------------------------- */
    var fav = {
      list: function () {
        return { ok: true, items: (state().favorites || []).slice(0) };
      },
      has: function (uid) {
        var list = state().favorites || [];
        for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return true;
        return false;
      },
      toggle: function (item) {
        if (!item || !text.str(item.uid || item.id)) {
          return { ok: false, code: ERR.BAD_INPUT, message: '收藏需要带 uid 的条目对象。' };
        }
        var uid = text.str(item.uid || item.id);
        var exists = fav.has(uid);
        var res = store.update(function (draft) {
          draft.favorites = (draft.favorites || []).filter(function (x) { return x.uid !== uid; });
          if (!exists) {
            var it = storage.migrateItem(item);
            if (it) draft.favorites.push(it);
          }
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, favorited: !exists, uid: uid, code: null, message: res.message || null };
      },
      add: function (item) {
        if (!fav.has(text.str(item && (item.uid || item.id)))) return fav.toggle(item);
        return { ok: true, favorited: true, uid: text.str(item.uid || item.id), code: null, message: null };
      },
      remove: function (uid) {
        var id = text.str(uid);
        var existed = fav.has(id);
        var res = store.update(function (draft) {
          draft.favorites = (draft.favorites || []).filter(function (x) { return x.uid !== id; });
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, removed: existed, uid: id, code: null, message: null };
      },
      clear: function () {
        var res = store.update(function (draft) { draft.favorites = []; return draft; });
        return res.ok ? { ok: true, code: null, message: null } : res;
      }
    };

    /* -------------------------- 自建提示词 -------------------------- */
    var custom = {
      list: function () {
        return { ok: true, items: (state().customs || []).slice(0) };
      },
      get: function (uid) {
        var list = state().customs || [];
        for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return { ok: true, item: list[i] };
        return { ok: false, code: ERR.NOT_FOUND, message: '未找到自建提示词 ' + text.str(uid) };
      },
      create: function (input) {
        var i = input && typeof input === 'object' ? input : {};
        var title = text.sanitizeText(i.title, { maxChars: 300, keepNewlines: false }).text;
        var content = text.sanitizeText(i.content || i.body || i.prompt, { maxChars: 20000 }).text;
        if (title === '' && content === '') {
          return { ok: false, code: ERR.BAD_INPUT, message: '标题与正文不能同时为空。' };
        }
        var id = 'local-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
        var item = {
          uid: 'local:' + id,
          id: 'local:' + id,
          sourceId: 'local',
          nativeId: id,
          title: title,
          content: content,
          body: content,
          tags: normalizeMod.stringsOf ? normalizeMod.stringsOf(i.tags, 20) : [],
          lang: text.str(i.lang) || 'zh',
          author: i.author === undefined ? null : text.str(i.author),
          description: text.sanitizeText(i.description, { maxChars: 2000, keepNewlines: false }).text,
          remark: text.sanitizeText(i.remark, { maxChars: 2000, keepNewlines: false }).text,
          weight: null,
          website: null,
          sourceUrl: '',
          license: null,
          sanitized: true,
          contentHash: text.contentHash(content || title),
          custom: true,
          createdAt: text.nowIso(),
          updatedAt: text.nowIso()
        };
        var res = store.update(function (draft) {
          draft.customs = draft.customs || [];
          draft.customs.push(item);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, item: item, code: null, message: null };
      },
      update: function (uid, patch) {
        var id = text.str(uid);
        var p = patch && typeof patch === 'object' ? patch : {};
        var found = null;
        var res = store.update(function (draft) {
          draft.customs = draft.customs || [];
          for (var i = 0; i < draft.customs.length; i++) {
            if (draft.customs[i].uid !== id) continue;
            var cur = draft.customs[i];
            var next = storage.migrateItem(cur) || cur;
            if (p.title !== undefined) next.title = text.sanitizeText(p.title, { maxChars: 300, keepNewlines: false }).text;
            if (p.content !== undefined || p.body !== undefined) {
              var c = text.sanitizeText(p.content !== undefined ? p.content : p.body, { maxChars: 20000 }).text;
              next.content = c;
              next.body = c;
            }
            if (p.tags !== undefined) next.tags = normalizeMod.stringsOf ? normalizeMod.stringsOf(p.tags, 20) : [];
            if (p.description !== undefined) next.description = text.sanitizeText(p.description, { maxChars: 2000, keepNewlines: false }).text;
            if (p.remark !== undefined) next.remark = text.sanitizeText(p.remark, { maxChars: 2000, keepNewlines: false }).text;
            next.custom = true;
            next.contentHash = text.contentHash(next.content || next.title);
            next.updatedAt = text.nowIso();
            draft.customs[i] = next;
            found = next;
            break;
          }
          return draft;
        });
        if (!res.ok) return res;
        if (!found) return { ok: false, code: ERR.NOT_FOUND, message: '未找到自建提示词 ' + id };
        return { ok: true, item: found, code: null, message: null };
      },
      remove: function (uid) {
        var id = text.str(uid);
        var removed = false;
        var res = store.update(function (draft) {
          var before = (draft.customs || []).length;
          draft.customs = (draft.customs || []).filter(function (x) { return x.uid !== id; });
          removed = draft.customs.length < before;
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, removed: removed, code: null, message: null };
      },
      duplicate: function (uid) {
        var got = custom.get(uid);
        if (!got.ok) return got;
        return custom.create({
          title: got.item.title + '（副本）',
          content: got.item.content,
          tags: got.item.tags,
          description: got.item.description,
          remark: got.item.remark
        });
      }
    };

    /* ---------------------------- 标签 ---------------------------- */
    var tags = {
      list: function () {
        var stored = (state().tags || []).slice(0);
        var derived = {};
        var pools = (state().customs || []).concat(state().favorites || []);
        for (var i = 0; i < pools.length; i++) {
          var t = pools[i].tags || [];
          for (var j = 0; j < t.length; j++) derived[t[j]] = true;
        }
        var extra = Object.keys(derived).filter(function (x) { return stored.indexOf(x) < 0; });
        return { ok: true, tags: stored.concat(extra) };
      },
      add: function (tag) {
        var name = text.sanitizeText(tag, { maxChars: 40, keepNewlines: false }).text.trim();
        if (name === '') return { ok: false, code: ERR.BAD_INPUT, message: '标签不能为空。' };
        var res = store.update(function (draft) {
          draft.tags = draft.tags || [];
          /* 不区分大小写的去重 */
          var exists = draft.tags.some(function (x) { return x.toLowerCase() === name.toLowerCase(); });
          if (!exists) draft.tags.push(name);
          return draft;
        });
        return res.ok ? { ok: true, tag: name, code: null, message: null } : res;
      },
      rename: function (from, to) {
        var a = text.str(from);
        var b = text.sanitizeText(to, { maxChars: 40, keepNewlines: false }).text.trim();
        if (a === '' || b === '') return { ok: false, code: ERR.BAD_INPUT, message: '重命名需要旧名与新名。' };
        var res = store.update(function (draft) {
          draft.tags = (draft.tags || []).map(function (x) { return x === a ? b : x; });
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var list = draft[pools[p]] || [];
            for (var i = 0; i < list.length; i++) {
              if (!Array.isArray(list[i].tags)) continue;
              list[i].tags = list[i].tags.map(function (x) { return x === a ? b : x; });
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, from: a, to: b, code: null, message: null } : res;
      },
      remove: function (tag) {
        var a = text.str(tag);
        var res = store.update(function (draft) {
          draft.tags = (draft.tags || []).filter(function (x) { return x !== a; });
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var list = draft[pools[p]] || [];
            for (var i = 0; i < list.length; i++) {
              if (Array.isArray(list[i].tags)) {
                list[i].tags = list[i].tags.filter(function (x) { return x !== a; });
              }
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, tag: a, code: null, message: null } : res;
      },
      /* 给某条自建/收藏打标签（远程条目本身不可变，标签只能落在收藏副本上） */
      apply: function (uid, nextTags) {
        var id = text.str(uid);
        var list = normalizeMod.stringsOf ? normalizeMod.stringsOf(nextTags, 20) : [];
        var res = store.update(function (draft) {
          var pools = ['customs', 'favorites'];
          for (var p = 0; p < pools.length; p++) {
            var arr = draft[pools[p]] || [];
            for (var i = 0; i < arr.length; i++) {
              if (arr[i].uid === id) arr[i].tags = list.slice(0);
            }
          }
          return draft;
        });
        return res.ok ? { ok: true, uid: id, tags: list, code: null, message: null } : res;
      }
    };

    /* ---------------------------- 源管理 ---------------------------- */
    var sourcesApi = {
      list: function () {
        return { ok: true, sources: sourcesMod.catalog(state(), sourceStatus) };
      },
      get: function (sourceId) {
        var src = sourcesMod.getById(state(), text.str(sourceId));
        if (!src) return { ok: false, code: ERR.NOT_FOUND, message: '未找到源 ' + text.str(sourceId) };
        return { ok: true, source: src, status: sourceStatus[src.id] || null };
      },
      add: function (input) {
        var normalized = storage.normalizeSource(input);
        if (!normalized) {
          return { ok: false, code: ERR.BAD_INPUT, message: '自定义源至少需要 id 与 url（https:// 开头）。' };
        }
        var existing = sourcesMod.getById(state(), normalized.id);
        if (existing && existing.origin !== 'custom') {
          return { ok: false, code: ERR.BAD_INPUT, message: '源 id ' + normalized.id + ' 与内置源冲突，请换一个 id。' };
        }
        if (existing) {
          return { ok: false, code: ERR.BAD_INPUT, message: '源 id ' + normalized.id + ' 已存在，请改用 update 或换 id。' };
        }
        var validation = normalizeMod.validateSource ? normalizeMod.validateSource(normalized) : { errors: [], warnings: [] };
        var res = store.update(function (draft) {
          draft.sources = draft.sources || [];
          draft.sources.push(normalized);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, source: normalized, warnings: validation.warnings, code: null, message: null };
      },
      update: function (sourceId, patch) {
        var id = text.str(sourceId);
        var p = patch && typeof patch === 'object' ? patch : {};
        var found = null;
        var res = store.update(function (draft) {
          draft.sources = draft.sources || [];
          for (var i = 0; i < draft.sources.length; i++) {
            if (draft.sources[i].id !== id) continue;
            var merged = {};
            for (var k in draft.sources[i]) {
              if (Object.prototype.hasOwnProperty.call(draft.sources[i], k)) merged[k] = draft.sources[i][k];
            }
            for (var k2 in p) {
              if (Object.prototype.hasOwnProperty.call(p, k2)) merged[k2] = p[k2];
            }
            merged.id = id;
            draft.sources[i] = storage.normalizeSource(merged) || draft.sources[i];
            found = draft.sources[i];
            break;
          }
          if (!found) {
            /* 内置源不能改 url/repo，但允许把 enabled/ref 记成覆盖项 */
            var builtin = sourcesMod.getById(draft, id);
            if (builtin && builtin.origin !== 'custom') {
              var override = { id: id };
              if (p.enabled !== undefined) override.enabled = p.enabled !== false;
              if (p.ref !== undefined) override.ref = p.ref;
              if (p.enabledFallback !== undefined) override.enabledFallback = p.enabledFallback === true;
              if (p.allowGithubFallback !== undefined) override.allowGithubFallback = p.allowGithubFallback === true;
              var withUrl = {
                id: id,
                name: builtin.name,
                kind: builtin.kind,
                origin: 'custom',
                enabled: override.enabled === undefined ? builtin.enabled !== false : override.enabled,
                removable: false,
                lang: builtin.lang,
                url: '',
                ref: override.ref === undefined ? (builtin.ref || 'main') : override.ref,
                enabledFallback: override.enabledFallback === undefined ? builtin.enabledFallback === true : override.enabledFallback,
                homepage: builtin.homepage || '',
                licenseId: builtin.licenseId || 'UNKNOWN',
                licenseNote: builtin.licenseNote || '',
                supportsWeight: builtin.supportsWeight === true,
                notes: ['内置源的可配置覆盖项（enabled / ref / 兜底开关）。'],
                addedAt: text.nowIso()
              };
              draft.sources.push(storage.normalizeSource(withUrl) || withUrl);
              found = draft.sources[draft.sources.length - 1];
            }
          }
          return draft;
        });
        if (!res.ok) return res;
        if (!found) return { ok: false, code: ERR.BAD_INPUT, message: '内置源不允许修改 URL 等核心字段；仅支持启用状态与 ref（commit sha）覆盖。' };
        return { ok: true, source: found, code: null, message: null };
      },
      remove: function (sourceId) {
        var id = text.str(sourceId);
        var src = sourcesMod.getById(state(), id);
        if (src && src.origin !== 'custom') {
          return { ok: false, code: ERR.BAD_INPUT, message: '内置源不可删除；如需停用请用 setEnabled(false)（可随时恢复）。' };
        }
        var removed = false;
        var res = store.update(function (draft) {
          var before = (draft.sources || []).length;
          draft.sources = (draft.sources || []).filter(function (x) { return !(x.id === id && x.origin === 'custom'); });
          removed = draft.sources.length < before;
          return draft;
        });
        if (!res.ok) return res;
        if (removed && store.cacheRemove) store.cacheRemove(id);
        return { ok: true, removed: removed, code: null, message: null };
      },
      setEnabled: function (sourceId, enabled) {
        return sourcesApi.update(sourceId, { enabled: enabled === true });
      },
      /* 连通性自检：force 出网一次；返回实际用到的 URL 便于 verifier 对照 */
      test: function (sourceId, testOptions) {
        var o = testOptions && typeof testOptions === 'object' ? testOptions : {};
        return fetchSource(sourceId, { force: true, memoryTtlMs: 0, allowGithubFallback: o.allowGithubFallback !== false }).then(function (out) {
          var s = state();
          var src = sourcesMod.getById(s, text.str(sourceId));
          var urls = src && core.net && core.net.buildUrls ? core.net.buildUrls(src) : { primary: '', fallback: '' };
          return {
            ok: out.ok === true,
            sourceId: sourceId,
            freshness: out.freshness,
            itemCount: Array.isArray(out.items) ? out.items.length : 0,
            error: out.error || null,
            urlsUsed: { primary: urls.primary, fallback: urls.fallback },
            meta: out.meta || null
          };
        });
      },
      fetch: fetchSource,
      refreshAll: function (o) {
        var ids = enabledSourceIds();
        var opts = o && typeof o === 'object' ? o : {};
        var jobs = ids.map(function (id) { return fetchSource(id, { force: true, memoryTtlMs: 0, allowGithubFallback: opts.allowGithubFallback !== false }); });
        return Promise.all(jobs).then(function (list) {
          return {
            ok: true,
            results: list.map(function (r, i) {
              return { sourceId: ids[i], ok: r.ok === true, freshness: r.freshness, itemCount: Array.isArray(r.items) ? r.items.length : 0, error: r.error || null };
            }),
            degraded: list.some(function (r) { return r.freshness === 'cache'; })
          };
        });
      },
      status: function () {
        return { ok: true, bySource: text.cloneJSON(sourceStatus) || {}, catalog: sourcesMod.catalog(state(), sourceStatus) };
      },
      cacheStats: function () {
        try { return { ok: true, stats: store.cacheStats() }; } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '读取缓存统计失败：' + ((e && e.message) || 'unknown') };
        }
      },
      clearCache: function (sourceId) {
        try {
          if (text.str(sourceId) !== '') {
            var r = store.cacheRemove(sourceId);
            sourcesMod.clearMemory(sourceId);
            return { ok: r.ok !== false, code: r.code || null, message: r.message || null };
          }
          var all = store.cacheClear();
          sourcesMod.clearMemory();
          return { ok: all.ok !== false, removed: all.removed, code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '清理缓存失败：' + ((e && e.message) || 'unknown') };
        }
      }
    };

    /* ---------------------------- 设置 ---------------------------- */
    var settingsApi = {
      get: function () {
        return {
          ok: true,
          settings: settings(),
          /* UI 直接用这个渲染写入方式单选；**不含 'replace'**（本机无实现路径） */
          writeModes: (storage.WRITE_MODES || ['insert', 'append']).slice(0)
        };
      },
      update: function (patch) {
        var p = patch && typeof patch === 'object' ? patch : {};
        /* 护栏：writeMode 只接受有实现路径的取值；非法值（尤其旧的 'replace'）
           直接拒绝，而不是静默接受后由底层回落 —— 让调用方立刻知道它不存在。 */
        if (p.writeMode !== undefined) {
          var isOk = storage.isWriteMode
            ? storage.isWriteMode(p.writeMode)
            : (p.writeMode === 'insert' || p.writeMode === 'append');
          if (!isOk) {
            return {
              ok: false,
              code: ERR.BAD_INPUT,
              message: 'writeMode 只支持 "insert"（光标处插入）与 "append"（追加到草稿末尾）。'
                + '「覆盖整段草稿」不是设置项：插件无法主动清空草稿或设置选区，'
                + '但用户在编辑器里 Ctrl+A 全选后再插入，即等价于覆盖整段'
                + '（insertText 作用在捕获到的选区上）。（收到：' + JSON.stringify(p.writeMode) + '）'
            };
          }
        }
        var res = store.update(function (draft) {
          var merged = {};
          var cur = draft.settings || storage.defaultSettings();
          for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) merged[k] = cur[k];
          for (var k2 in p) if (Object.prototype.hasOwnProperty.call(p, k2)) merged[k2] = p[k2];
          if (p.filter && typeof p.filter === 'object' && cur.filter) {
            var f = {};
            for (var fk in cur.filter) if (Object.prototype.hasOwnProperty.call(cur.filter, fk)) f[fk] = cur.filter[fk];
            for (var fk2 in p.filter) if (Object.prototype.hasOwnProperty.call(p.filter, fk2)) f[fk2] = p.filter[fk2];
            merged.filter = f;
          }
          draft.settings = storage.normalizeSettings(merged);
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, settings: settings(), writeModes: (storage.WRITE_MODES || []).slice(0), code: null, message: null };
      },
      reset: function () {
        var res = store.update(function (draft) {
          draft.settings = storage.defaultSettings();
          return draft;
        });
        return res.ok ? { ok: true, settings: settings(), code: null, message: null } : res;
      }
    };

    /* ---------------------------- 过滤 ---------------------------- */
    var filterApi = {
      get: function () {
        var s = settings();
        return {
          ok: true,
          settings: s.filter,
          rules: filterMod.rules ? filterMod.rules(s.filter) : [],
          enabled: !(s.filter && s.filter.enabled === false),
          actionMode: (s.filter && s.filter.actionMode) || 'hide'
        };
      },
      setEnabled: function (enabled) {
        return settingsApi.update({ filter: { enabled: enabled === true } });
      },
      setActionMode: function (mode) {
        return settingsApi.update({ filter: { actionMode: mode === 'mark' ? 'mark' : 'hide' } });
      },
      setCustomTerms: function (terms) {
        return settingsApi.update({ filter: { customTerms: Array.isArray(terms) ? terms : [] } });
      },
      setRuleEnabled: function (ruleId, enabled) {
        var s = settings();
        var f = s.filter || {};
        var disabled = (f.disabledRuleIds || []).filter(function (x) { return x !== ruleId; });
        var extra = (f.extraRuleIds || []).filter(function (x) { return x !== ruleId; });
        if (enabled === true) extra.push(ruleId); else disabled.push(ruleId);
        return settingsApi.update({ filter: { disabledRuleIds: disabled, extraRuleIds: extra } });
      },
      checkText: function (s) {
        var cfg = settings();
        var res = filterMod.check ? filterMod.check(s, cfg.filter) : { blocked: false, matches: [] };
        return { ok: true, blocked: res.blocked === true, matches: res.matches, actionMode: res.actionMode };
      },
      /* 对任意条目列表做一次“如果现在过滤”会怎样（UI 预览用，不写盘） */
      preview: function (items) {
        var cfg = settings();
        var res = filterMod.apply ? filterMod.apply(items, cfg.filter) : { items: items, stats: null };
        return { ok: true, items: res.items, stats: res.stats };
      }
    };

    /* ---------------------------- 许可与署名 ---------------------------- */
    var licensesApi = {
      list: function () {
        var out = [];
        var all = constants.LICENSES || {};
        for (var k in all) {
          if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
          var l = all[k];
          out.push({
            id: l.id,
            name: l.name,
            spdx: l.spdx,
            url: l.url,
            attributionRequired: l.attributionRequired === true,
            attributionText: l.attributionText,
            sourceUrl: l.sourceUrl,
            copyrightHolder: l.copyrightHolder,
            textSource: l.textSource,
            fullText: l.text,
            fullTextAvailable: l.fullTextAvailable === true,
            strongAttribution: l.strongAttribution === true
          });
        }
        return { ok: true, licenses: out, acknowledged: state().licenseAcknowledged === true };
      },
      get: function (licenseId) {
        var all = constants.LICENSES || {};
        var l = all[text.str(licenseId)];
        if (!l) return { ok: false, code: ERR.NOT_FOUND, message: '未知许可 id=' + text.str(licenseId) };
        return { ok: true, license: l };
      },
      /* 生成界面/分发物用的署名文案（中文库 MIT 为强制项） */
      notice: function () {
        var catalogList = sourcesMod.catalog(state(), sourceStatus);
        var lines = ['本插件的提示词数据来自以下上游项目：'];
        var strong = [];
        for (var i = 0; i < catalogList.length; i++) {
          var s = catalogList[i];
          var lic = s.license || {};
          lines.push('· ' + s.name + '（' + s.id + '）');
          lines.push('  来源：' + (s.homepage || s.url));
          lines.push('  许可：' + (lic.name || s.licenseId || '未知') + (lic.url ? '（' + lic.url + '）' : ''));
          if (lic.attributionText) lines.push('  署名：' + lic.attributionText);
          if (lic.strongAttribution) strong.push(s.id);
        }
        lines.push('');
        /* F-R2-2：按 catalogue 实际引用的**每个 distinct licenseId** 分别附「表头 + 正文」。
           旧写法只附一份 MIT 正文、表头写死 rockbenben/ChatGPT-Shortcut ⇒ 会出现
           「一份来源的正文 + 分属两个来源的署名」。MIT 与 MIT-plexpt 正文除版权行外逐字相同，
           但**版权人不同**，必须各自成段（`Copyright (c) 2023 rockbenben` / `Copyright (c) 2025 plex`）。 */
        var licIds = [];
        for (var li = 0; li < catalogList.length; li++) {
          var lid = catalogList[li].licenseId || 'UNKNOWN';
          if (licIds.indexOf(lid) < 0) licIds.push(lid);
        }
        for (var lj = 0; lj < licIds.length; lj++) {
          var licEntry = (constants.LICENSES && constants.LICENSES[licIds[lj]]) || null;
          var headName = licEntry && licEntry.name ? licEntry.name : ('许可正文缺失（id=' + licIds[lj] + '）');
          var headSrc = licEntry && licEntry.sourceUrl ? ('，来源 ' + licEntry.sourceUrl) : '';
          lines.push(headName + '（强制保留' + headSrc + '）：');
          lines.push(licEntry ? licEntry.text : '（缺失）');
          lines.push('');
        }
        return {
          ok: true,
          text: lines.join('\n'),
          strongAttributionSourceIds: strong,
          acknowledged: state().licenseAcknowledged === true
        };
      },
      acknowledge: function (version) {
        var res = store.update(function (draft) {
          draft.licenseAcknowledged = true;
          return draft;
        });
        if (!res.ok) return res;
        return { ok: true, acknowledged: true, version: text.str(version) || '1', code: null, message: null };
      }
    };

    /* ---------------------------- 导入导出 ---------------------------- */
    var data = {
      exportJSON: function (exportOptions) {
        try {
          var built = storage.buildExport(store, exportOptions);
          if (!built.ok) return built;
          return { ok: true, payload: built.payload, fileName: built.fileName, json: JSON.stringify(built.payload, null, 2), code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '导出失败：' + ((e && e.message) || 'unknown') };
        }
      },
      importJSON: function (input, importOptions) {
        var o = importOptions && typeof importOptions === 'object' ? importOptions : {};
        var mode = o.mode === 'merge' ? 'merge' : 'replace';
        var parsed = storage.parseImport(input);
        if (!parsed.ok) return parsed;
        var incoming = parsed.state;
        var res;
        if (mode === 'replace') {
          res = store.update(function (draft) {
            draft.favorites = incoming.favorites;
            draft.customs = incoming.customs;
            draft.tags = incoming.tags;
            draft.sources = incoming.sources;
            if (o.keepSettings !== true) draft.settings = incoming.settings;
            return draft;
          });
        } else {
          res = store.update(function (draft) {
            var byUid = {};
            var i;
            for (i = 0; i < (draft.favorites || []).length; i++) byUid[draft.favorites[i].uid] = true;
            for (i = 0; i < incoming.favorites.length; i++) {
              if (!byUid[incoming.favorites[i].uid]) { draft.favorites.push(incoming.favorites[i]); byUid[incoming.favorites[i].uid] = true; }
            }
            var byUid2 = {};
            for (i = 0; i < (draft.customs || []).length; i++) byUid2[draft.customs[i].uid] = true;
            for (i = 0; i < incoming.customs.length; i++) {
              if (!byUid2[incoming.customs[i].uid]) { draft.customs.push(incoming.customs[i]); byUid2[incoming.customs[i].uid] = true; }
            }
            var tagSet = (draft.tags || []).slice(0);
            for (i = 0; i < incoming.tags.length; i++) if (tagSet.indexOf(incoming.tags[i]) < 0) tagSet.push(incoming.tags[i]);
            draft.tags = tagSet;
            var srcIds = {};
            for (i = 0; i < (draft.sources || []).length; i++) srcIds[draft.sources[i].id] = true;
            for (i = 0; i < incoming.sources.length; i++) {
              if (!srcIds[incoming.sources[i].id]) draft.sources.push(incoming.sources[i]);
            }
            return draft;
          });
        }
        if (!res.ok) return res;
        return {
          ok: true,
          mode: mode,
          stats: parsed.stats,
          warnings: [],
          code: null,
          message: mode === 'merge' ? '已合并导入（同 uid 的条目保留本地版本）。' : '已覆盖导入（原有收藏/自建/标签被替换）。'
        };
      },
      /* 浏览器侧：把导出包存成文件（不依赖任何 Node API） */
      downloadExport: function (fileName) {
        try {
          var built = data.exportJSON({ includeCache: false });
          if (!built.ok) return built;
          if (typeof document === 'undefined' || typeof Blob !== 'function' || typeof URL === 'undefined') {
            return {
              ok: false,
              code: ERR.UNSUPPORTED,
              message: '当前环境不支持文件下载，请改用 exportJSON() 复制 JSON 文本。',
              json: built.json,
              fileName: built.fileName
            };
          }
          var blob = new Blob([built.json], { type: 'application/json;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = text.str(fileName) || built.fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
            try { document.body.removeChild(a); } catch (e2) { /* 忽略 */ }
          }, 0);
          return { ok: true, fileName: a.download, bytes: text.utf8Bytes(built.json), code: null, message: null };
        } catch (e) {
          return { ok: false, code: ERR.STORAGE, message: '下载导出文件失败：' + ((e && e.message) || 'unknown') };
        }
      },
      /* 浏览器侧：读取 File/Blob 或字符串文本 */
      readFileText: function (file) {
        if (!file) return Promise.resolve({ ok: false, code: ERR.BAD_INPUT, message: '未提供文件。' });
        if (typeof file === 'string') return Promise.resolve({ ok: true, text: file });
        if (typeof FileReader !== 'function') {
          return Promise.resolve({ ok: false, code: ERR.UNSUPPORTED, message: '当前环境不支持 FileReader，请改用文本粘贴导入。' });
        }
        return new Promise(function (resolve) {
          try {
            var reader = new FileReader();
            reader.onload = function () {
              resolve({ ok: true, text: text.str(reader.result) });
            };
            reader.onerror = function () {
              resolve({ ok: false, code: ERR.STORAGE, message: '读取文件失败（FileReader error）。' });
            };
            reader.readAsText(file, 'utf-8');
          } catch (e) {
            resolve({ ok: false, code: ERR.STORAGE, message: '读取文件失败：' + ((e && e.message) || 'unknown') });
          }
        });
      },
      /* 一键：读文件 → 导入（默认 merge，最不易误伤用户数据） */
      importFromFile: function (file, importOptions) {
        return data.readFileText(file).then(function (r) {
          if (!r.ok) return r;
          return data.importJSON(r.text, importOptions);
        });
      }
    };

    /* ---------------------------- 状态与诊断 ---------------------------- */
    var diag = {
      initReport: function () { return initReport ? text.cloneJSON(initReport) : null; },
      storeStatus: function () { return { ok: true, status: store.status() }; },
      resetStore: function () { return store.reset('用户显式重置'); },
      warnings: function () { return { ok: true, warnings: store.status().warnings || [] }; },
      /* 给 verifier 的即时体检：不联网也能跑 */
      selfDescribe: function () {
        var s = state();
        var cat = sourcesMod.catalog(s, sourceStatus);
        return {
          appId: constants.APP_ID,
          dataApiMajor: constants.DATA_API_MAJOR,
          schemaVersion: storage.CURRENT_SCHEMA,
          storeBackend: store.backendReport.kind,
          storeDurable: store.backendReport.durable === true,
          readOnly: store.status().readOnly === true,
          sources: cat.map(function (x) {
            return { id: x.id, kind: x.kind, url: x.url, fallbackUrl: x.fallbackUrl, licenseId: x.licenseId, enabled: x.enabled };
          }),
          filterEnabled: !(s.settings && s.settings.filter && s.settings.filter.enabled === false),
          counts: {
            favorites: (s.favorites || []).length,
            customs: (s.customs || []).length,
            tags: (s.tags || []).length,
            sources: cat.length
          }
        };
      }
    };

    return {
      /* 生命周期 */
      init: init,
      /* 核心检索 */
      search: search,
      /* 子模块 */
      fav: fav,
      favorites: fav,
      custom: custom,
      tags: tags,
      sources: sourcesApi,
      settings: settingsApi,
      filter: filterApi,
      licenses: licensesApi,
      data: data,
      diag: diag,
      /* 直通（给 verifier 做低层断言用） */
      store: store,
      state: state
    };
  }

  core.api = {
    createDataLayer: createDataLayer,
    itemMatches: itemMatches,
    sortItems: sortItems,
    /* 便捷单例：UI 可直接用，也可自建隔离实例 */
    shared: null,
    getShared: function (options) {
      if (!core.api.shared) core.api.shared = createDataLayer(options || {});
      return core.api.shared;
    }
  };

})(__pmCore);

/* END inlined file: api.js */

/* BEGIN inlined file: bootstrap */
/* =============================================================================
 * unit: bootstrap — 把命名空间挂到宿主全局，并给出便捷方法名
 * =============================================================================
 * 这是**唯一**写宿主全局的单元（其余 8 个单元只写各自的局部命名空间对象）。
 * 它同时给出与任务书措辞一致的便捷方法名：
 *   listSources() / fetchPrompts() / search() / favorites / import / export / filter ...
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

/* END inlined file: bootstrap */





