# core · 提示词市场数据层

本目录是 **t3（datasmith）** 的交付物：数据源适配器、在线拉取与降级、本地持久化、
内容过滤、许可署名、JSON 导入导出。

> 完整接口契约见 **[`docs/DATA-01-数据层接口.md`](../../docs/DATA-01-数据层接口.md)**
> （uismith / verifier 直接引它；浏览器半身获取机制见该文 §2.5）。

## 给 t-ui（uismith）的一句话

> **把 `core/browser.js` 的全部内容原样、顶格放进 `client.js` 即可，
> 无需任何构建步骤。** 执行后 `globalThis.__pmCore` 就是数据层：
> `__pmCore.getMarket()` + `market.init()` + `market.search({tab:'market'})`。

## 给 Host / Node

```js
const { load } = await import('./core/index.js');
const core = (await load()).core;          // { constants, text, filter, storage, normalize, net, sources, api }
const market = core.api.createDataLayer({});
market.init();
const page = await market.search({ tab: 'market', q: '', page: 1 });
```

## 文件清单

| 文件 | 行数 | 作用 |
|---|---|---|
| `browser.js` | ~4850 | ★ **浏览器半身成品源码**：9 个顶格 IIFE 单元（8 核心 + bootstrap），免构建可直接内联 |
| `constants.js` | 483 | 真值集中地：三源 URL/字段、许可正文、配额、过滤默认名单、错误码 |
| `text.js` | 361 | 纯文本化（去标签/解实体/清控制字符）、escapeHTML、FNV-1a 哈希、安全 JSON |
| `filter.js` | 313 | 可配置内容过滤（默认开启，hide/mark 两种动作） |
| `storage.js` | 931 | 版本化持久化（localStorage 优先 + 内存降级）、迁移护栏、配额护栏、缓存 |
| `normalize.js` | 617 | RFC4180 CSV 解析器 + 四个适配器 + 统一模型（content/body 同值） |
| `net.js` | 479 | URL 拼装、超时、重试退避、429 容忍、base64 兜底解码、commit sha 锁定 |
| `sources.js` | 450 | 源注册表合并、单源获取管线（缓存优先 + 静默降级）、多源聚合 |
| `api.js` | 1027 | 门面：search / fav / custom / tags / sources / settings / filter / licenses / data / diag |
| `index.js` | 205 | ESM 加载入口（沙箱求值 8 个核心文件） |
| `node-reader.js` | 45 | 仅 Node：读核心源码文本（只在动态 import 路径上可见） |
| `assemble-browser.js` | ~240 | 【可选】由核心文件拼装/校验 `browser.js`（**不是前置条件**） |
| `build-client-bundle.js` | ~130 | 【可选·已降级】校验 `client.js` 内联内容是否与 `browser.js` 一致（**不是前置条件**） |
| `selftest-node.js` | ~780 | Node 侧自检（真语法编译 + 算法/降级矩阵断言，离线可跑） |
| `.browser-parts/` | — | 拼装说明与早期片段（历史保留；权威形态是 `browser.js` 本身） |

## 四条硬规则（改代码前先看）

1. **默认地址一律 `cdn.jsdelivr.net`**；源码里**不得出现**被阻断的 raw 域名（自检脚本会扫）。
2. **核心文件不得出现 `import` / `export`**（`index.js` / `node-reader.js` / 两个可选工具除外）
   —— 浏览器半身是内联脚本，无编译步骤。
3. **不使用模板字面量（反引号）**；核心代码用 ES2017- 子集 + 字符串拼接。
4. `browser.js` 的**每个单元必须是自带 IIFE 的完整语句、顶格书写** —— link 安装下
   `client.js` 可能被分段写入，任何单一巨型表达式都会造成语法不合法的中间态。

## 自检（⚠️ 以下命令**均未实测**：队内会话没有任何命令执行面）

```text
# A) 不需要任何 JS 运行时（本机只有 Windows PowerShell 5.1，无 pwsh）
powershell -NoProfile -ExecutionPolicy Bypass -File "…\core\check-data-layer.ps1"
# B) 需要 Node（用户反馈本机 node = D:\nodejs\node.exe v24.19.0）
node "…\core\selftest-node.js"
# C) 可选看护
node "…\core\assemble-browser.js" --verify
node "…\core\build-client-bundle.js" --check
```

退出码均为 `0 = 通过 / 1 = 有失败项`。
**这些命令与 `selftest-node.js` 的断言在本会话从未被执行过**，只能表述为
「脚本与断言已编写，待用户实跑验证」，不得写成「已通过」。
