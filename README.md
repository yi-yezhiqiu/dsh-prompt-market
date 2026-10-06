# dsh-prompt-market

**DeepSeek Harness 的提示词市场插件** —— 在对话框里一键浏览、搜索、收藏提示词，选中后**直接写入输入框**。

零后端、免构建、数据只存本机。

---

## 它解决什么问题

用 AI 写东西时，好用的提示词总是散落在浏览器书签、笔记、别人的微信消息里。真要用的时候要么找不到，要么复制过来还得改半天。

这个插件把「找提示词 → 用提示词」压缩成**两步**：

1. 点输入框左边的「**提示词导入**」
2. 点某一条的「**插入**」

---

## 功能

| 模块 | 说明 |
|---|---|
| **市场** | 三个内置源（英文经典库 + 两个中文库），支持搜索、分类筛选、分页、权重排序 |
| **收藏** | 一键收藏/取消，收藏夹独立成页 |
| **我的** | 新建 / 编辑 / 删除自己的提示词，可打标签 |
| **源管理** | 查看每个源的连通性、缓存条目、许可与署名；**可添加自己的 JSON 源**（附详细说明书） |
| **内容过滤** | 默认开启，拦截越狱类与成人角色扮演条目；六条规则可逐条开关，支持自定义屏蔽词 |
| **导入导出** | 收藏 + 自建 + 标签 + 设置整体导出为 JSON，可换机迁移 |

### 写入行为

- **默认插入中文说明**（`description` 字段）——便于阅读和修改
- 可在「源管理 → 高级 → 写入字段」切换到**英文原文**（`prompt` 字段）
- 写入走 DSH 的 `inputActions.insertText()`，因此**插入后可 Ctrl+Z 撤销**
- 输入框已有内容时，默认**插入到光标处**，不会覆盖你已写的东西
- 想把整段替换掉：先 `Ctrl+A` 全选草稿，再点「替换」

> ⚠️ **能力边界（如实说明）**：插件的 `InputActions` 只提供 `captureInsertion` / `insertText` / `setDraft`，**没有清空草稿或设置选区的能力**。因此「替换整段」依赖你手动全选——插件**无法主动**清空你的草稿。

---

## 安装

### 前置

- DeepSeek Harness 桌面端（已验证版本 `0.2.0-rc.2`）
- Node.js（仅打包脚本需要；插件本身**运行时不依赖 Node**）

### 步骤

```cmd
dsh plugin --profile desktop add "<本仓库路径>\plugin"
```

`dsh` 不在 PATH 时，用 DSH 安装目录下的垫片，例如：

```cmd
"<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本仓库路径>\plugin"
```

然后**完全退出并重新打开** DeepSeek Harness（profile 是 startup profile，装完需要重启）。

也可以在 GUI 的**设置 → 插件**页面里填本地路径安装。

### 验证安装

重启后，输入框左侧应出现「**提示词导入**」按钮。点开应有四个页签。

---

## 卸载

```cmd
dsh plugin --profile desktop remove dsh-prompt-market
```

或 GUI 插件页移除。**卸载不会自动清掉你的收藏数据**（它在浏览器 localStorage 里，键名前缀 `dsh-prompt-market:`）。需要清干净时在开发者工具里删掉这些键。

---

## 数据与隐私

| 项 | 说明 |
|---|---|
| 存储位置 | 浏览器 **localStorage**：`dsh-prompt-market:state`（主状态）、`:cache:<源id>`（各源缓存）、`:state:quarantine`（损坏留档）、`:state:probe`（探测哨兵） |
| 是否上传 | **不上传任何数据**，无账号、无服务端 |
| 是否写磁盘文件 | 不写（插件代码除外） |
| 数据损坏时 | 原数据移入 `quarantine` 留档，**不会直接清空** |
| localStorage 不可用时 | 自动降级为内存模式（功能可用、重启即丢），界面会显示「本次会话不保留」 |
| 隐私细节 | 写入诊断只记录**长度与哈希**，不记录草稿内容 |

---

## 内置源与许可

| 源 | 许可 | 说明 |
|---|---|---|
| [f/prompts.chat](https://github.com/f/prompts.chat) | **CC0 1.0** | 英文经典提示词库，公有领域 |
| [rockbenben/ChatGPT-Shortcut](https://github.com/rockbenben/ChatGPT-Shortcut) | **MIT** | 中文库；`prompt` 多为英文原文，中文在 `description` |
| [PlexPt/awesome-chatgpt-prompts-zh](https://github.com/PlexPt/awesome-chatgpt-prompts-zh) | **MIT** | 纯中文库，标题与正文均为中文 |

**署名与许可正文**见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

> **内容不随包分发**：插件在运行时从 jsDelivr CDN 拉取上述源的数据，本仓库**不包含**这些库的内容。

### 自定义源

「源管理」页可添加任意返回 **JSON 数组**的地址。插件会自动识别常见字段名：

- 标题：`title` / `act` / `name` / `label` / `prompt_title`
- 正文：`prompt` / `content` / `body` / `text` / `value`
- 标签：`tags`
- 嵌套结构：自动取「第一个元素是对象的数组」，或指定 `listPath`

GitHub 仓库请用 jsDelivr 镜像地址（`raw.githubusercontent.com` 在部分网络环境不可达）：

```
https://cdn.jsdelivr.net/gh/<用户名>/<仓库名>@main/<文件路径>.json
```

---

## 目录结构

```
plugin/                      ← 安装目标（DSH 只加载这里）
├── package.json             包元数据：dsh.bundle.patch + dsh.client
├── cordis.patch.yml         profile 层补丁（一行 insert 挂载本插件）
├── index.js                 Host 半身（ESM）
├── client.js                ★ 浏览器半身（装配产物，DSH 唯一加载的客户端入口）
├── core/                    数据层：源适配器、缓存、持久化、过滤、许可
│   ├── *.js                 9 个可独立阅读的单元
│   ├── browser.js           浏览器半身成品源码（免构建，可直接内联）
│   ├── selftest-node.js     数据层自检（Node 运行，无需浏览器）
│   └── check-data-layer.ps1 静态自检（无需 JS 运行时）
├── ui/                      界面：按钮、面板、四页签、写入通道
│   ├── 00-core.js … 80-client-shell.js
│   ├── check-ui.ps1         界面静态自检
│   └── DESIGN.md            界面设计契约
└── lib/write-draft.js       inputActions 低层封装（仅探针/诊断用）
```

**关于 `client.js`**：它是 `core/browser.js` 的 9 个单元 + `ui/` 的 8 个单元按 `ui/80-client-shell.js` 模板**装配**而成。本插件**没有编译步骤**——源码即产物，所以装配结果也纳入了版本控制。

---

## 设计要点

- **无构建**：手写 `window.__ModuleLoader__.load({ id, factory })`，不依赖打包器、无 JSX、无 TypeScript
- **两级降级**：网络失败 → 用本地缓存；缓存也没有 → 返回可展示的错误态，**不白屏、不抛未捕获异常**
- **纯文本渲染**：远程内容一律转义，危险块（`script`/`style`/`template`/`iframe`）整块剔除
- **写入通道唯一**：产品路径只走 `insertText`（DSH 官方唯一承诺可撤销的写入方式）；`setDraft` 仅用于诊断探针
- **产物冻结纪律**：评审通过后不再改动装配产物——任何改动都会使已绑定的版本指纹与验证记录失效

---

## 自检

安装后可选（用于确认产物完整性）：

```cmd
node plugin\core\selftest-node.js
powershell -NoProfile -ExecutionPolicy Bypass -File plugin\ui\check-ui.ps1
```

---

## 状态与已知限制

本插件经过独立评审（3 轮，全部 blocker 已闭合）与真机实测。以下是**如实声明**：

**已实测**（真机运行确认）：按钮可见、面板四页签、插入为中文、写入后可发送、关面板后草稿保留、**Ctrl+Z 可撤销**、写入字段切换、详情关闭、自定义源说明书、许可与署名分源呈现。

**未实测**（设计正确但未取得运行期证据）：`setDraft` 归因、条件「替换」动作、断网降级、三源逐项解析、内容过滤对真实中文条目的生效、重启后收藏/自建持久化、打包可安装性、自检脚本退出码。

**已知限制**：

- 自检含一条约 78 秒用例（生产默认超时预算不可注入，未改核心）
- `plugin/client.js` 保留 2 行装配模板占位注释，会导致界面自检 `A14` 报 **WARN**（非 FAIL，无功能影响）
- 界面层存在少量 `globalThis.prompt` 直读（与既有代码风格一致，未重构）

---

## 许可

本插件代码以 **MIT** 发布，见 [LICENSE](LICENSE)。

内置数据源的许可与署名见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)——**分发或修改本插件时请一并保留**。
