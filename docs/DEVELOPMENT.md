# dsh-prompt-market（提示词市场）

DeepSeek Harness 桌面端插件：输入框旁「提示词导入」按钮 + 浮层市场面板
（市场 / 收藏 / 我的 / 源管理），选中后文本直接写入输入框。零后端。

**本目录就是可安装的包根**（`package.json` 在这一层），安装方式见
[`../docs/ENV-01-环境与打包事实.md`](../docs/ENV-01-环境与打包事实.md) §4。

## 文件

| 文件 | 作用 | 归属 |
|---|---|---|
| `package.json` | 包元数据 + `dsh.bundle.patch` + `dsh.client` 声明 | envsmith（已定稿，改动前先看 ENV-01 §2.1 校验规则） |
| `cordis.patch.yml` | bundle patch：一行 insert 把本包挂成 profile 层 | envsmith |
| `client.js` | 浏览器半身（手写 ModuleLoader bundle，无编译步骤）。**当前内容 = 装配完成的正式产物**：`PM-CORE-INLINE` 区（9 个数据单元）+ `PM-UI-INLINE` 区（8 个 UI 单元），由 `80-client-shell.js` 模板装配 | t-ui 装配 |
| `index.js` | Host 半身（ESM，当前为空 apply） | t-data 扩展 |
| `lib/write-draft.js` | **`inputActions` 的低层封装：仅用于探针/诊断**（`writeText` / `writeAndVerify` / `inspectInputActions`；其 `writeText` 默认 **`setDraft` 优先**，见 [#写入通道](#写入通道f-8-裁决后的分工)） | 诊断用途；**产品面板不要用它** |
| `README.md` | 本文件 | 全员 |

## 写入通道（F-8 裁决后的分工）

`inputActions` 是 `conversation.input.left` 槽位组件 **props 上的稳定标准 prop**
（不是 ctx 服务）。**写什么**由数据层决定（`settings.writeField` = `'description'`（默认，中文）｜`'prompt'`；
`settings.writeMode` = `'insert'`（默认，光标处插入）｜`'append'`，见
[`../docs/DATA-01-数据层接口.md`](../docs/DATA-01-数据层接口.md) §4.8）。

**写入动作的分工是硬规定（F-8），两条通道不可混用：**

| 用途 | 归属 | 主通道 | 依据 |
|---|---|---|---|
| **产品面板插入**（req-9） | `ui/` 自带 helper：`ns.write.insert(...)` → `ns.write.finalizeInsert(...)`；整段覆盖走 `ns.write.replace(...)`（仅当捕获到的选区覆盖全文，否则 `ns.write.refuseReplace(...)` 拒绝并提示先全选） | **`insertText(text, captureInsertion())`** | DSH-01 req-9 要求写入**可被 Ctrl+Z 撤销**，官方只为 `insertText` 承诺「undoable plain-text edit」（asar:403343） |
| **探针 / 诊断**（C2 归因） | `lib/write-draft.js`（`__promptMarketWrite`） | `setDraft` 优先 | 诊断需要「`setDraft` 单独调用」这条对照路径，其顺序对归因有用 |

> ⚠️ **不要**把产品面板接回 `lib/write-draft.js`：该模块 `setDraft` 优先，接回去会命中 F-8 的失败判据
> （写入不可撤销）。`lib/write-draft.js` 里的 `fallbackSetDraft` 也带「**不得被产品路径调用**」注释。
> 产品路径只经 `ui/30-write.js` 的 helper（`client.js` 内联其副本）；产品路径的 `method` 恒为
> `'insertText'`，**不存在** `method:'setDraft'` 分支。

产品侧调用形态（摘自 `ui/60-components.js` 的 `A.insertItem`）：

```js
// 产品插入：只经 ns.write，主通道 insertText
var before = ctx.getDraft();
var rep = ns.write.insert({ actions: ctx.actions, getDraft: ctx.getDraft, draft: before, text: text });
publish(clone(rep));
if (rep.pending === true) {                      // 异步读回断言（把「是否真入框」变成可判定结论）
  setTimeout(function () {
    var fin = ns.write.finalizeInsert(rep, { beforeDraft: before, draftAfter: ctx.getDraft(), text: text,
                                             normalizedRange: rep.coversAllBasis && rep.coversAllBasis.normalizedRange });
    publish(clone(fin));
    if (fin.verified === true) ns.store.setState({ panelOpen: false });
  }, 0);
}
// rep.method 恒为 'insertText'；rep.verified / rep.insertTextReturned / rep.rejectedAt 见 30-write.js
```

铁律：
1. **禁止跨 `await` 复用 span**：`insertText` 的 span 必须当场 `captureInsertion()`。
2. **产品通道只用 `insertText`**；「覆盖整段」= 用户在编辑器里 Ctrl+A 全选后再插入（插件无法主动清空草稿或设选区）。
3. **面板关闭时不要清草稿**（不要调 `setDraft('')`）。
4. 任何失败都返回 `{ ok:false, reason }`，**不抛错**——槽位组件抛错会整块空白（asar:292610）。

详见 [`../docs/SPIKE-01-写入试验报告.md`](../docs/SPIKE-01-写入试验报告.md) 与
`ui/DESIGN.md`（§10 实施记录、F-8 判据）。

## 自检 / 验证

```powershell
# 本机只有 Windows PowerShell 5.1（**没有 pwsh**），故用 powershell 调用：
powershell -NoProfile -ExecutionPolicy Bypass -File "..\docs\check-plugin.ps1"   # 静态自检（结构 + 决策表），退出码 0/1
powershell -NoProfile -ExecutionPolicy Bypass -File "..\docs\check-plugin.ps1" -Json   # 机器可读

# 界面/装配静态自检（纯 ASCII）与数据层自检（需 node）：
powershell -NoProfile -ExecutionPolicy Bypass -File ".\ui\check-ui.ps1"
node ".\core\selftest-node.js"
```

> ⚠️ 上述命令**均未在队内实测**（本会话无命令执行面）；用户终端可跑。
> 运行时的四问实测（按钮可见性 / 草稿入框 / 写入后发送 / 关面板后保留）见
> [`../docs/SPIKE-01-写入试验报告.md`](../docs/SPIKE-01-写入试验报告.md) §6.2。

## 两条铁律

1. **无编译步骤**：`client.js` 直接是浏览器可执行的纯 JavaScript（不用 JSX/TS，
   不 require 任何 `@deepseek-ai/*` 客户端包，只用 `React.createElement`）。
2. **只引用 `--dsw-alias-*` 主题 token**，不写硬编码颜色，light/dark 由 token 解析。
