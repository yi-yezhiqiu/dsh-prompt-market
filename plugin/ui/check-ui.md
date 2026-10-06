# check-ui 使用说明（t4 / uismith · 静态自检）

## 0. 这份脚本是什么，不是什么

- **是什么**：`plugin/ui/check-ui.ps1` —— 「提示词市场」客户端界面单元的**静态**自检脚本，
  只读文件、检查结构配平、禁用模式与跨单元契约，**不需要任何 JS 运行时**，退出码 `0/1`。
- **不是什么**：它**不运行插件**。所有结论都属于「**静态已核对**」；
  「按钮真的出现在输入框旁 / 草稿真的写进去了 / Ctrl+Z 真的能撤销 / 重启后收藏还在 / 断网降级不白屏」
  这些属于「**运行时未实测**」，由用户验收闸门（t8）承接。**不得把本脚本的通过写成"功能已通过"。**

## 1. 怎么跑（本机没有 pwsh，只有 Windows PowerShell 5.1）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "plugin\ui\check-ui.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "plugin\ui\check-ui.ps1" -Json
```

- 退出码：`0` = 全部 **FAIL 级**检查通过；`1` = 至少一条 FAIL。
  `WARN`/`INFO` 不影响退出码（例：`client.js` 尚未装配时 A13/A14 只是 INFO）。
- 预期输出（非 `-Json`）形如：

```
=== prompt-market UI static self-check (t4 / uismith) ===
script dir : <仓库根目录>\plugin\ui

[PASS] U1  - all 8 UI units present and non-empty
[PASS] A1  - 00-core.js balanced raw counts: braces 12, parens 31
...
[A13] INFO - plugin/client.js not found - assembly not started ...
--- STATIC CHECKED (this run) ---
  FAIL-level failures : 0
--- RUNTIME NOT TESTED (belongs to the user acceptance gate) ---
  * button actually visible in conversation.input.left
  ...
RESULT: PASS (static only)
```

### 编码与兼容性（重要）

- 本脚本**全 ASCII**（中文说明只在本 `.md` 里）。自证判据（会话内即可跑，任何人可复核）：
  `grep path="plugin\ui\check-ui.ps1" pattern="[^\x00-\x7F]"` ⇒ **期望 0 命中**。
  零命中 ⇒ 5.1「无 BOM 的 .ps1 按 ANSI 解码」的问题不存在，`-File` 直跑即可。
- ⚠️ **本脚本从未在本机执行过**（队内无命令执行面：`pwsh` 报
  `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<会话工作区目录>)`，命令体不执行）。
  因此「可运行」这一结论**由用户终端提供**；本文档不主张「实测可用」。
- 兜底（**均为语法层面核对、未实测**）：
  1. 转存为带 BOM 的 UTF-8 再跑：`[IO.File]::WriteAllText($dst,(Get-Content -LiteralPath $src -Raw -Encoding UTF8),(New-Object System.Text.UTF8Encoding($true)))` 然后 `-File $dst`；
  2. 与 PowerShell 无关的**语法**兜底：`Copy-Item plugin\ui\*.js $env:TEMP\; D:\nodejs\node.exe --check "$env:TEMP\30-write.js"`（只验语法，不跑逻辑）。

## 2. 检查项清单（与脚本里的 id 一一对应）

| id | 检查 | 级别 |
|---|---|---|
| U1 | 8 个 UI 单元齐备且非空 | FAIL |
| A1 | 每个单元 `{}`/`()` 原始计数配平（朴素计数，字符串/注释可能干扰 ⇒ 只作 WARN） | WARN |
| A2 | `plugin/core/browser.js` 有**9 对** `BEGIN/END inlined file:` 区间（`constants.js … bootstrap`，`bootstrap` 无 `.js` 后缀；子串容错匹配） | FAIL |
| A3 | UI 单元里**无** hex / rgb / hsl 颜色字面量 | FAIL |
| A3b | 每个 `var(--…)` 的参数都在 CONSTRAINTS-01 §D 的 **14 个 token** 白名单内 | FAIL |
| A4 | 无 `import` / `export` 语句 | FAIL |
| A4b | `require()` 只请求 `'react'` | FAIL |
| A4c | 无 JSX 痕迹（只允许 `React.createElement`） | FAIL |
| A5 | 被阻断域名**不得作为可请求 URL 出现**（判定：非注释行里存在**带引号的地址** `'…'`/`"…"` 且其中出现该域名；注释行忽略、自检/夹具文件 `*selftest*`/`*check-*` 豁免） | FAIL |
| A5b | 同一域名**裸字面量**（未包在引号里的地址形态）出现在非注释、非夹具行 ⇒ 仅**告警**；该形态只有在运行时拼装时才安全（见 `60-components.js` 的 `PM_BLOCKED_RAW_HOST`） | WARN |
| A6 | `70-entry.js` 含两个槽位名与两个 entry id | FAIL |
| A7 | `30-write.js` 里 `insertText(` **早于** `setDraft(`（主通道防回归） | FAIL |
| A7b/A7c | UI 单元**不引用** `writeAndVerify` / `write-draft`（F-8：产品路径不得走 t2 诊断模块） | FAIL |
| A7d | 不引用 `appendSeparated`（整段 payload 交给插入式语义 = 数据损坏） | FAIL |
| A7e | UI 单元里**不存在** append 语义入口（F-9 裁决：删除而非置灰） | FAIL |
| A8 | `PM-NO-WRITE` 区存在，且区内**不含** `insertText(` / `setDraft(` | FAIL |
| A9 | 草稿指纹字段齐全：`beforeLength/afterLength/beforeHash/afterHash/replaced/verified/insertTextReturned` | FAIL |
| A10 | 写入策略由数据层 `writeModes` 驱动；**无**硬编码取值域数组字面量 | FAIL |
| A11 | 探针报告含 `setDraftAlone` / 三元 `conclusion` / `spanProbe.fields` / `refused` | FAIL |
| A11b | 数据层未就绪时读 `__pmCoreBrowserError`（不自造原因） | FAIL |
| A12 | 存在 `componentDidCatch` 错误边界 | FAIL |
| A12b | 错误码文案映射覆盖数据层错误码集合（≥4 个才 PASS） | WARN |
| A13 | **装配后**：`client.js` 的 `PM-CORE-INLINE` 区与 `browser.js` 的 9 个单元体**逐行一致**（去行首缩进/去空行后）；不一致给首个差异行号 | FAIL（装配未开始时为 INFO） |
| A14 | **装配后**：`client.js` 的 `PM-UI-INLINE` 区与 `plugin/ui/*.js` 一致 | WARN（未装配时 INFO） |

## 3. 「静态已核对」vs「运行时未实测」的分栏（验收第 8 条要求）

| 结论 | 证据来源 | 本次状态 |
|---|---|---|
| 两个槽位的注册代码、entry id、token 使用、写入主通道顺序、指纹字段、探针字段、错误边界 | 本脚本 + 会话内 `grep` 复核 | **静态已核对** |
| 按钮可见性、面板开合、草稿真实入框、Ctrl+Z 可撤销、localStorage 持久化、断网降级、探针三元结论 | 用户终端 / t8 闸门 | **运行时未实测** |

## 4. 装配移交（t4 范围之外，需指派）

t4 的 in-scope 路径是 `plugin/ui/`；`plugin/client.js` 属 t2 产物，**本任务不得改动**。
因此装配动作（把数据层与 UI 单元填进 `client.js`）留给集成任务或队长指派的执行者：

1. 以 `plugin/ui/80-client-shell.js` 为外壳模板（含 `PM-CORE-INLINE` / `PM-UI-INLINE` 两个标记区）；
2. 把 `plugin/core/browser.js` 的 **9 个单元体**（含各自 `BEGIN/END inlined file:` 注释）原样顶格粘进 `PM-CORE-INLINE` 区；
3. 把 `plugin/ui/00-core.js … 70-entry.js` 共 **8 个单元**按序原样顶格粘进 `PM-UI-INLINE` 区；
4. **每粘一个单元后 `client.js` 都必须是合法 JS**（link 安装 ⇒ 下次启动即生效，不允许半成品被加载）；
5. 粘完再跑一次本脚本：A13/A14 会从 INFO 变成真实比对（一致 ⇒ PASS，不一致 ⇒ 给出首个差异行号）。

> `docs/check-ui.ps1` 的路径**不在 t4 的 in-scope 路径内**，故本任务把它交付在 `plugin/ui/check-ui.ps1`；
> 若团队希望统一放在 `docs/` 下，请由授权范围内的任务复制一份（内容逐字节相同即可）。
