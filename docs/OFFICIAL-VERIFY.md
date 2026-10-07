# 官方端到端验证记录（`dsh-plugin-dev verify`）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-07 |
| 环境 | Windows · DeepSeek Harness **0.2.0-rc.2** · Node 24.19.0 · pnpm 11.7.0 |
| 工具 | `dsh-plugin-guide` 的 `dsh-plugin-dev` CLI（**0.3.22**，镜像源所给版本） |
| 命令 | `dsh-plugin-dev verify --cwd <repo> --dsh <dsh.cmd> --pnpm <pnpm 垫片> --base … --headless …` |

---

## 一、结果

| 步骤 | 结果 | 说明 |
|---|---|---|
| `pack` | ✅ | `pnpm pack` 通过 |
| `install` | ✅ | `dsh-base` + `dsh-headless` + **本插件**一次装进**全新临时 profile** |
| `dump-config` | ✅ | 配置转储中出现本插件包名（工具失败时的提示原文即 `dump-config output did not contain "<包名>"`） |
| `headless-smoke` | ❌ | `dsh: TRANSPORT: DeepSeek Messages transport failed` |
| `uninstall` | ⏸ | 前一步失败即中止，未执行 |

**判断：失败与插件无关 —— 已由对照实验证明（见第三节）。**

---

## 二、这个命令做什么

```
① pnpm pack                    把插件打成 tarball
② mkdtemp                     建一个一次性 DSH_HOME
③ 写 profiles/<name>/pnpm-workspace.yaml    （固定的 scratch 白名单）
④ dsh plugin add <base> <headless> <tarball>  一次装三个
⑤ dsh --profile <name> --dump-config          转储配置，检查含包名
⑥ dsh --profile <name> "Reply with exactly: ok"   真实 headless 回合
⑦ dsh plugin remove <包名>
```

判定第 ⑥ 步的原文（工具源码）：

```js
function isSmokeOk(stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  return text.includes("MISSING_CREDENTIAL") || /(^|[^a-z])ok([^a-z]|$)/i.test(text);
}
```

**它不碰你的真实 profile**：每个子命令都带 `DSH_HOME=<一次性目录>`。

---

## 三、对照实验（决定性证据）

用一个**什么都不做的插件**（一行 Loader `insert` + 一个空 `apply`，
见仓库同级的 `.control-plugin/`）跑**同一套 verify**：

| 步骤 | 本插件 | 空插件（control） |
|---|---|---|
| `pack` | ✅ | ✅ |
| `install` | ✅ | ✅ |
| `dump-config` | ✅ | ✅ |
| `headless-smoke` | ❌ `TRANSPORT` | ❌ **`TRANSPORT`（逐字相同）** |
| `suggestions` | 同样两行 | 同样两行 |

> **一个 `apply` 为空的插件也过不了这一步。**
> 因此该失败由**运行环境**决定，不能归因于任何插件逻辑。

### 补充一：也在「桌面端**完全退出**」的条件下跑过

冒烟那一步执行的是 `dsh-desktop-host\lib\cli.js`，所以一度怀疑
**运行中的桌面端占用了同一条传输通道**。为此在**完全退出桌面端**
（含托盘进程，`tasklist` 已查不到 `DeepSeek Harness.exe`）之后重跑：

```
desktop-app-running-at-start=no
✓ pack    ✓ install    ✓ dump-config
✗ headless-smoke    dsh: TRANSPORT: DeepSeek Messages transport failed
```

**结果完全相同** ⇒ 该假设**已排除**：与桌面端是否运行无关。

### 补充二：另一个方向的对照

在**同一台机器**上手工复现冒烟那一步（全新临时 `DSH_HOME`、装 harness 与本插件、
连 `cwd` 都对齐），得到的是 **`MISSING_CREDENTIAL`** ——
**那正是工具会判通过的无凭证结果**（`ok (keyless)`）。

两次手工复现均如此。差别在于官方 `verify` 会额外装上 **`dsh-base`**
（我的执行沙箱禁止 spawn，装不了它带的原生构建，故无法在本地补上这一环）。

### 已排除的原因

| 怀疑 | 排除方式 | 结论 |
|---|---|---|
| 插件逻辑 | 空插件对照实验 | **排除** —— 失败步骤与文字逐字相同 |
| 桌面端占用传输通道 | 完全退出桌面端后重跑 | **排除** —— 结果相同 |
| TLS 证书（本机有中间人） | 直接对 `api.deepseek.com:443` 握手 | **排除** —— 不设 `NODE_EXTRA_CA_CERTS` 也握手成功 |
| 工作目录 / 继承的环境变量 | 与工具逐项对齐的手工复现 | **排除** —— 得到的是**被接受**的结果 |
| `--base` / `--headless` 版本不匹配 | 已按 `dsh --version` 覆盖 | **已修** —— 否则连 `install` 都过不去 |

**仍未确定**：装上 `dsh-base` 后，凭证服务从哪里取到了可用凭证，
于是冒烟真的发起了模型调用并在传输层失败。定位这一点需要动到用户自己的凭证存储，
代价与收益不成比例，故止步于此。

**是否通过这一步，与插件无关 —— 这一点已经确证。**

---

## 四、我们踩到的两个工具问题（都不是本插件的问题）

### 1. `--base` / `--headless` 默认钉死在 `0.1.7-rc.2`

工具源码（0.3.22）：

```js
base:     "@deepseek-ai/dsh-base@0.1.7-rc.2"
headless: "@deepseek-ai/dsh-headless@0.1.7-rc.2"
```

在 DSH **0.2.x** 上会直接被拒：

```
dsh: installation rejected: Plugin @deepseek-ai/dsh-headless@0.1.7-rc.2 is incompatible
     with dsh 0.2.0-rc.2 ... Exact-version exemption: not active.
```

**绕过办法**：显式传与 runtime 同版本的 `--base` / `--headless`（本仓库的
`../verify-official.cmd` 会自动读 `dsh --version` 并传入）。

### 2. 冒烟的接受条件不覆盖 `TRANSPORT`

`isSmokeOk` 只认 `MISSING_CREDENTIAL` 或独立的 `ok`。
而「有凭证但调用失败」会输出 `TRANSPORT`（抛出点：
`dsh-llm-deepseek/lib/index.js`，`throw new LlmError("DeepSeek Messages transport failed", "TRANSPORT", …)`），
**两者都不满足** ⇒ 判失败。

也就是说：**这一步实际在验的是「模型 API 能不能通」，而不只是「插件树能不能加载」。**
在「有可用凭证」的机器上，它的结果取决于网络，与插件无关。

---

## 五、如何自行复现

```cmd
:: 对真实插件
D:\提示词市场项目\verify-official.cmd

:: 对空的对照插件
D:\提示词市场项目\verify-control.cmd
```

脚本会自动：建 pnpm 垫片 → 装官方工具 → 读 `dsh --version` 选定 base/headless →
清掉 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`（让冒烟走无凭证路径）→ 跑 verify。

> 该脚本纯 ASCII，且所有路径均由 `%~dp0` 派生 —— cmd.exe 按 OEM 代码页读取 `.cmd`，
> 文件里写字面非 ASCII 路径会被破坏。

---

## 六、本插件的验证现状（如实）

| 证据 | 状态 |
|---|---|
| 官方工具 `pack` / `install` / `dump-config` | ✅ **通过**（这三步才是真正验插件的步骤） |
| 官方工具 `headless-smoke` | ❌ 环境性失败，**已用空插件对照证明与本插件无关** |
| 从 npm 安装（`pnpm add dsh-prompt-market`） | ✅ 本机实跑：7 个文件、四个导出全部解析、`client.js` 指纹与仓库一致 |
| 第三方机器安装 | ✅ 另一位用户在他自己机器上装成功过（那台机器没有 `git`） |
| 界面行为（按钮 / 插入 / 撤销） | ✅ 维护者真机确认 |

**未实测**：断网降级 · 重启后收藏与自建持久化 · 内容过滤对真实中文条目的运行期生效 ·
条件「替换」动作。这一栏与其他文档保持一致口径。
