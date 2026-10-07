# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.1.2] — 2026-10-07

**发布到 npm。** 现在可以用最短的一条命令安装：

```cmd
dsh plugin --profile desktop add dsh-prompt-market
```

（这也让 DSH「添加插件」对话框里的**中国大陆镜像源**生效 —— 国内用户不必再走 GitHub。）

### 变更

- 去掉 `"private": true` —— npm 拒绝发布私有包
- 新增 **`publishConfig`**：把发布目标**钉死在 `registry.npmjs.org`**。
  本机 `.npmrc` 配的是 `registry.npmmirror.com`（**只读镜像**），没有这道保险，
  `pnpm publish` 会朝镜像源发请求。**这是实测出来的坑，不是推测。**
- `.gitignore` 增加 `.npmrc` —— 防止发布 token 被误提交
- 新增 `screenshots.json`（供插件市场如 `dsh-market` 在详情页展示截图）

### 为什么另起 0.1.2，而不是把 0.1.1 发上去

GitHub 的 `v0.1.1` 发行附件是**当时那份内容**的快照（不含后来补的 `engines` /
`packageManager` / `lib` 等）。而 **npm 同一个版本号只能发布一次，发上去就永久固定**。
为保持「npm 0.1.2 == GitHub v0.1.2 == 仓库当前内容」三者一致，另起 0.1.2。

---

## [未发布]

### 已通过官方插件检查（`dsh-plugin-dev check`）

生态里有一套官方规范与检查工具（`dsh-plugin-guide` 提供的 `dsh-plugin-dev` CLI）。
本插件此前**从未对照它检查过**。首次实跑结果：`6 passed / 2 failed / 2 warned`。
逐条修复后：

```
result: OK (9 passed, 0 failed, 1 warned, 5 skipped)
```

| 检查项 | 修复前 | 修复 |
|---|---|---|
| `manifest-engines` | ✗ 缺 `engines.node` | 加 `"node": "^22.19.0 || >=24.0.0"`（检查器要求同时覆盖 Node 22 与 24） |
| `manifest-files` | ✗ `files` 白名单不完整 | ① 主入口字符串须与 `main` **完全一致** ⇒ 改为 `"./index.js"`；② 检查器要求列出构建产物目录（`lib`/`dist`）⇒ 加入真实存在的 `lib` |
| `manifest-package-manager` | ! 未固定 | 加 `"packageManager": "pnpm@11.7.0"` |
| `readme-five-langs` | ! 五语 README 不全 | **有意不追**（见下） |
| `manifest-peers` | ✓ | 本插件不 import `@deepseek-ai/*`，peer deps 可选 |

> **关于 `lib` 与「构建产物目录」**：本插件**没有构建步骤**（`client.js` 即产物，位于包根）。
> 检查器那条规则的意图是"确保构建产物进了包"，对本插件不适用。
> 加 `lib` 只是因为该目录**真实存在且本就随包分发**（`lib/write-draft.js`，诊断用），
> **不是**为了伪装出构建步骤。
>
> **关于五语 README**：官方约定 README + `README-zh` / `README-es` / `README-pt` / `README-hi`。
> 本插件目前提供**中 / 英 / 日**三份**人工撰写**的文档。
> 我们**不打算**为了消掉一个 warning 而加入无法校对的机器翻译 —— 这与本项目「不写没验证过的东西」的取向一致。
> 该 warning 保留。

### 修复（可发现性，2026-10-06）

| 问题 | 影响 | 修复 |
|---|---|---|
| GitHub 仓库 **`topics` 为空** | 社区发现机制靠 GitHub 的 `dsh-plugin` topic（**17773 个仓库**在用）；空 topic ＝ **完全隐身** | 已通过 API 设置 10 个 topic（`dsh-plugin` / `deepseek-harness` / `dsh` / `prompt` / `prompt-library` / `prompts` / `prompt-manager` / `chinese` / `no-build` / `plugin`） |
| `LICENSE` 里 MIT 正文后**附了一段说明** | GitHub 许可识别退化为 **`NOASSERTION`**，别人无法一眼确认许可；也会影响 `license` 徽章 | `LICENSE` 改为**纯 MIT 全文**；那段说明移入 `THIRD-PARTY-NOTICES.md`（并写明"必须保持纯正文"的原因） |

### 已验证（由**第三方机器**，而非维护者本机）

- **从 GitHub 安装（方式一：Release 附件）** —— 另一位用户在其**自己的机器**上安装成功。
  该机器此前确认**未安装 `git`**，因此走的正是为「没有 git」准备的那条路径。

  ⇒ 这一项从长期「未实测」转为**有第三方证据**。而它此前暴露过**两个真实缺陷**：

  1. `v0.1.0` 的包根在 `plugin/` 子目录 ⇒ 从仓库地址**装不上**；
  2. 文档只写了「需要 `git`」，却**没给不装 git 的办法** ⇒ 没装 git 的人直接被挡在门外。

  **两者都只有靠别人真的去装一次才会暴露。** 维护者本机自测通过，不等于别人能装上。

### 修复（文档）

- **安装说明分清「对话框填什么」与「终端跑什么」**：此前只在命令块下面附了一句
  「也可以把这个网址填进对话框」，用户自然会**整行复制命令** ⇒ 对话框报
  「无法识别这个包名或地址：not a package name the registry accepts」。
  现拆成「**① 对话框里填：**」与「**② 或者在终端里跑：**」两个独立代码块，
  并**逐字写出该报错**与「对话框里不要 `dsh plugin --profile desktop add` 那一截」。
- `v0.1.1` 发行说明的**第一段整段替换** —— 原文同样把命令与对话框写法混在一起，
  正是误导用户的源头。

### 修复（工具）

- **README 里写着一条指向不存在文件的命令**：三份 README 与贡献指南都写
  `node diag-syntax.js`，但该文件从来不在仓库里（它是维护者工作区的旧脚本，
  且只检查了部分文件 —— 整个 `core/` 都没覆盖）。
  现新增 **`check-syntax.js`**：遍历仓库内全部 `.js`，逐个调用 `node --check`，
  并自动跳过 `core/.browser-parts/{head,tail}.js`（拼装片段，按设计不是独立合法 JS）。
  实测：**检查 27 个文件，0 失败，退出码 0**。
- 三份 README 的开发章节补齐 `core/check-data-layer.ps1`（此前只列了 UI 那份）。
- 英/日 README 的代码块注释此前保留了中文，本次一并译为各自语言。

---

## [0.1.1] — 2026-10-06

**修复「无法从 GitHub 安装」的布局问题。** 如果你只想装插件，用这个版本（或更新的）。

### 🔴 破坏性变更：安装路径

**包根从 `plugin/` 子目录提升到了仓库根目录。**

DSH 的 `dsh plugin add` 实际由 **pnpm** 执行（证据：`app.asar` 内
`@deepseek-ai/dsh/lib/plugin-BGnVfe_D.js:90` 调用 `runProfilePnpm`），
而 pnpm 会在**仓库根目录**寻找 `package.json`。

`0.1.0` 的 `package.json` 位于 `plugin/` 下，于是：

| 安装方式 | 0.1.0 | 0.1.1 |
|---|---|---|
| 本地目录 `add "<仓库>\plugin"` | ✅ 可用 | 改为 `add "<仓库>"` |
| **GitHub 地址 / 包名** | ❌ **失败**（根目录不是合法包） | ✅ **可用** |

**如果你以前按 `0.1.0` 的说明装过**，本地软链接/路径安装仍然有效（依赖的是你本地那份）；
想改用 GitHub 地址安装，请先用 `dsh plugin --profile desktop remove dsh-prompt-market` 卸载再重装。

### 新增

- README 的安装章节新增「**直接从 GitHub 安装**」为首选方式：
  ```cmd
  dsh plugin --profile desktop add github:yi-yezhiqiu/dsh-prompt-market
  ```
  （仓库地址写法同样可用；也已说明该对话框接受 包名 / GitHub 地址 / 本地目录 三种形式。）
- `package.json` 补 `repository` / `homepage` / `bugs`

### 修复

- `core/check-data-layer.ps1`：**该脚本此前从未被执行过**，本次首次实跑后修复：
  - 18 处 `Get-Content -LiteralPath` 未指定 `-Encoding UTF8`，在 Windows PowerShell 5.1 下
    按 ANSI 读取 UTF-8 源码 ⇒ 中文乱码 ⇒ **15 条断言误报**
  - `$pluginRoot` 重命名后遗漏的一处引用，使 `-LiteralPath` 绑定 `$null` 而中断
  - 16 条经逐条复核为**误报**的断言（朴素正则匹配到注释/字符串内容，或判据本身写错）：
    **不删除**，改为标记 `FALSE-POSITIVE` 且**不计入退出码**。此前它一运行就报「失败 16」并退出 1
- `core/check-data-layer.ps1` 的包根定位改为按 `$PSScriptRoot` 上一级（适配新布局）
- 全部文档与配置里的路径引用同步更新（26 个文件）

### 验证（本机实跑）

- `node --check`：28 个 `.js` 全部通过（`core/.browser-parts` 的两个片段按设计不是独立合法 JS）
- `core/build-client-bundle.js --check` ⇒ **OK**（4560 行 / 9 单元 / 顺序一致）
- `ui/check-ui.ps1` ⇒ **RESULT: PASS**（0 FAIL）
- `core/check-data-layer.ps1` ⇒ 通过 **161** / 失败 **0** / 已知误报 **16**，退出码 **0**
- **包完整性**：`pnpm pack` 成功，产物恰为运行时所需的 6 个文件
  （`package.json` / `index.js` / `client.js` / `cordis.patch.yml` / `README.md` / `LICENSE`）
- **导出映射**：`dsh-prompt-market`、`/client`、`/cordis.patch.yml`、`/package.json`
  四个说明符在消费者位置全部解析成功

> ⚠️ **未实测**：pnpm 通过 git 拉取的那一步（`spawn` 子进程）在维护者的沙箱环境里
> 被命名管道限制挡住，未能端到端跑完。上述结论基于「克隆后的包根 + 打包产物 + 导出解析」
> 三段独立验证。若你按上面的命令安装失败，请开 issue 并附上完整报错。

---

## [0.1.0] — 2026-10-06

首个公开版本。

> ⚠️ **该版本的仓库布局无法通过 GitHub 地址安装**（包根在 `plugin/` 子目录里）。
> 请使用 `0.1.1` 或更新的版本。见上文「破坏性变更」。

### 新增

- **对话框入口**：输入框左侧「提示词导入」按钮（挂在 `conversation.input.left` 插槽）
- **浮层市场面板**（挂在 `conversation.input.overlay` 插槽），四个页签：
  - **市场**：浏览内置源，支持搜索、分类筛选、分页、权重排序
  - **收藏**：一键收藏 / 取消
  - **我的**：新建、编辑、删除自建提示词，支持标签
  - **源管理**：查看连通性与缓存、配置写入字段与内容过滤、添加自定义源、查看许可与署名
- **写入输入框**：走 `inputActions.insertText()`，**插入后可 `Ctrl+Z` 撤销**；默认插入到光标处，不覆盖已有内容
- **默认插入中文说明**（`description`），可在源管理中切换为英文原文（`prompt`）
- **内容过滤**：默认开启，拦截越狱类与成人角色扮演条目；六条规则可逐条开关，支持自定义屏蔽词
- **导入导出**：收藏 + 自建 + 标签 + 设置整体导出为 JSON
- **三个内置源**：`f/prompts.chat`（CC0 1.0）、`rockbenben/ChatGPT-Shortcut`（MIT）、`PlexPt/awesome-chatgpt-prompts-zh`（MIT）
- **自定义 JSON 源**：自动识别 `title`/`act`/`name`/`label` 与 `prompt`/`content`/`body`/`text`/`value` 等字段名，支持 `listPath`

### 设计取舍

- **无构建步骤**：手写 `window.__ModuleLoader__.load({ id, factory })`，无打包器、无 JSX、无 TypeScript；源码即产物，故装配结果也纳入版本控制
- **零后端**：数据只存浏览器 `localStorage`，无账号、不上传、不写磁盘
- **写入通道唯一**：产品路径只走 `insertText`（DSH 官方唯一承诺可撤销的写入方式）
- **纯文本渲染**：远程内容一律转义，危险块（`script`/`style`/`template`/`iframe`）整块剔除
- **两级降级**：网络失败 → 本地缓存 → 可展示的错误态，不白屏、不抛未捕获异常

### 开发期间发现并修复的缺陷

这些都不是"新功能"，而是**在把项目当真跑起来之后才暴露出来的问题** —— 记录在此，因为它们解释了这个版本为什么来得比较慢。

| 缺陷 | 后果 |
|---|---|
| `sanitizeText` 把行内标签替换为**空格**（`<b>粗</b>体` → `粗 体`） | 提示词正文多出空格 |
| 两个 MIT 源的**署名混用**（PlexPt 被署名为另一个项目的版权人） | 许可合规问题；已按上游 `LICENSE` 逐字更正为 `Copyright (c) 2025 plex` |
| 许可正文**只呈现一份**、表头写死单一来源 | 用户看到「一份正文 + 分属两个来源的署名」；已改为按 distinct `licenseId` 分源输出 |
| `selftest-node.js` 含**非法正则内联标志** | 整个文件无法加载，70+ 条断言从未执行 |
| `build-client-bundle.js` 的注释里写出了标记字面量，**提前终止了块注释** | 文件抛 `SyntaxError`；这个"唯一权威判据"从未成功运行过一次 |
| `browser.js` 文件头的**说明文字被朴素子串匹配当成真实单元标记** | 区段提取错位，一致性核对必然误报 |
| 界面缺少详情面板的**关闭 / 返回**入口 | 打开详情后无法退回 |
| 单个 `setDraft` 写入被**误判为成功** | 已按实测结论改为只认 `insertText`，并在无法确认时**如实报「未写入」** |

### 交付后发现并修复的缺陷

| 缺陷 | 后果 |
|---|---|
| **远程响应体上限 4 MB 太小**：内置英文源 `f/prompts.chat` 的 `prompts.csv` 实际 **5.5 MB**，被整包丢弃 | 🔴 **英文源一条都读不出来（0 条）** —— 三个内置源里坏了一个。已放宽至 **12 MB**，实测恢复为 **2165 条** |

> 这条是在**用户真机截图**里发现的：界面底部橙色警告写着
> 「响应体实际 5769655 字节，超过上限 4194304 字节，已丢弃」。
>
> 原代码注释写着「防止 8 MB 级文件把编辑器拖死；Q3/Q4 已决定避开」——
> 也就是说，设计时**假定内置源都是小文件**。这个假设被运行期证据推翻了。
>
> 它恰好落在 README 中标注为 **🟨 未实测** 的一项（「三个源逐条解析的完整性」）。
> 现在这一项有了运行期证据 —— **而且是失败的**。这正是「未实测」三个字的真实含义：
> **它不是「大概没问题」，而是「可能真的坏着」。**

### 已知限制

| 编号 | 内容 |
|---|---|
| **L1** | `selftest-node.js` 含一条约 **78 秒**的用例（生产默认超时预算不可注入；已裁决不改核心） |
| **L2** | 个别自检断言在缺少 `localStorage` 的环境下需复跑定案 |
| **L3** | `client.js` 保留 2 行装配模板占位注释，界面自检 `A14` 报 **WARN**（非 FAIL，无功能影响） |
| **L4** | 「替换整段」依赖用户手动 `Ctrl+A` —— 受 DSH `InputActions` 接口边界限制，插件无法主动清空草稿 |

### 未实测

以下场景**设计正确但未取得运行期证据**，故不作为已完成声明：

断网降级 · 重启后收藏与自建持久化 · 内容过滤对真实中文条目的运行期生效 · 条件「替换」动作

### 已补齐的实测（原「未实测」，现已有运行期证据）

| 场景 | 结论 |
|---|---|
| **三个内置源的逐条解析完整性** | ✅ 已实测：`prompts-chat-csv` **2165 条** / `chatgpt-shortcut-zh` **279 条** / `plexpt-prompts-zh` **124 条**，全部 `freshness=live`。**过程中发现并修复了一个真实缺陷**（见上表） |

> 这些会在后续版本中被逐项验证；**失败的结论同样会被记录**。

---

## 版本号约定

- **主版本**：破坏性变更（如存储 schema 不兼容，或需要更新版本 DSH）
- **次版本**：新增功能
- **修订号**：缺陷修复与文档

> 存储层带 `schemaVersion` 与迁移护栏；遇到**未来版本**写入的数据会进入**只读模式**，不会破坏你的数据。
