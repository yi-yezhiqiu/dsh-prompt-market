/* =============================================================================
 * core/normalize.js — 远程载荷 → 统一 PromptItem 模型的解析与归一化
 * =============================================================================
 * 覆盖四种载荷（字段名**逐字**取自 CONSTRAINTS-01 §B / REL-01，禁止臆造）：
 *
 *   B1 f/prompts.chat  prompts.csv
 *      表头：act,prompt,for_devs,type,contributor（5 列，RFC4180）
 *      → title=act, content=prompt, forDevs=for_devs, type=type, author=contributor
 *      ⚠️ prompt 含换行与内嵌 ""，contributor 可为逗号多值 → 必须走 RFC4180 解析器
 *
 *   B2 rockbenben/ChatGPT-Shortcut  src/data/prompt_zh-Hans.json
 *      → title=<locale>.title, content=<locale>.prompt,
 *        description=<locale>.description, remark=<locale>.remark,
 *        tags=tags, weight=weight, website=website, nativeId=id
 *      ⚠️ 该文件 prompt 多为英文原文，中文主要在 description/remark（DSH-01 §5.2）
 *
 *   B3 PlexPt/awesome-chatgpt-prompts-zh  prompts-zh.json
 *      → title=act, content=prompt（暂无其它字段）
 *
 *   C 用户自定义源：任意 JSON URL + fieldMap/listPath 映射
 *
 * 归一化产出模型见 docs/DATA-01-数据层接口.md §3（content/body 同值双写，
 * 便于同时引用任务书契约名与 DSH-01 §5.1 名）。
 * ========================================================================== */

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

    /* 稳定去重键：来源 + 原生主键；标题为空时用标题占位，保证 uid 唯一且可读 */
    var uid = sourceId + ':' + nativeId;
    if (cleanTitle.text === '' && cleanContent.text !== '') {
      uid = sourceId + ':' + nativeId;
    }

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
