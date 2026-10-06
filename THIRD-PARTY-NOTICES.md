# Third-party notices

本插件（`dsh-prompt-market`）自身代码以 MIT 发布，见 [LICENSE](LICENSE)。

本文件处理的是**运行时拉取的内置提示词源**的许可与署名义务。

### 关于 [LICENSE](LICENSE) 里那行版权人

`LICENSE` 是**标准的 MIT 全文，不含任何附加段落** —— 这是**有意为之**：
只有保持纯正文，GitHub 的许可识别（licensee）才能自动判定为 `MIT`；
一旦在末尾追加说明段落，它会退化为 `NOASSERTION`，使别人无法一眼确认许可。

因此那行版权人写成 **`dsh-prompt-market contributors`**（项目本身不携带任何个人信息）。
**如果你是维护者、想换成自己的名字或组织，直接改那一行即可** —— 它不影响本文件里的第三方义务。

另：**MIT 只覆盖本插件自身的源码**。插件在运行时拉取的提示词数据属于各自的上游项目，
由它们自己的许可约束（见下文）。

> **重要：内容不随包分发。**
> 本仓库**不含**任何上游提示词数据。插件在运行时通过 `cdn.jsdelivr.net` 拉取下列源的
> JSON/CSV 数据，并缓存在用户本机浏览器的 localStorage 中。因此本仓库**不构成对上游内容的再分发**。
> 但插件在用户界面上展示这些来源，故仍**完整履行署名义务**。

---

## 1. f/prompts.chat（原 awesome-chatgpt-prompts）

- 来源：<https://github.com/f/prompts.chat>
- 运行时地址：`https://cdn.jsdelivr.net/gh/f/prompts.chat@main/prompts.csv`
- 许可：**CC0 1.0 Universal（公有领域贡献）**

上游 `README.md` 的 License 段落逐字声明：

> **Prompt content and data** (prompts.csv, PROMPTS.md, user-submitted prompts) is dedicated to the
> public domain under [CC0 1.0 Universal](LICENSE-CC0)

CC0 不要求署名。本插件仍按产品约定在界面「许可与署名」中标出来源，仅为诚实标注，不构成额外义务。

---

## 2. rockbenben/ChatGPT-Shortcut

- 来源：<https://github.com/rockbenben/ChatGPT-Shortcut>
- 运行时地址：`https://cdn.jsdelivr.net/gh/rockbenben/ChatGPT-Shortcut@main/src/data/prompt_zh-Hans.json`
- 许可：**MIT License**
- 版权人：**Copyright (c) 2023 rockbenben**

MIT 许可要求：在软件的所有副本或实质性部分中**保留上述版权声明与本许可声明**。

### MIT License（rockbenben/ChatGPT-Shortcut）

```
MIT License

Copyright (c) 2023 rockbenben

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**内容过滤提示**：该库含 DAN 越狱与成人角色扮演条目。本插件**默认开启内容过滤**拦截此类内容，
并允许用户在「源管理」中配置。

---

## 3. PlexPt/awesome-chatgpt-prompts-zh

- 来源：<https://github.com/PlexPt/awesome-chatgpt-prompts-zh>
- 运行时地址：`https://cdn.jsdelivr.net/gh/PlexPt/awesome-chatgpt-prompts-zh@main/prompts-zh.json`
- 许可：**MIT License**
- 版权人：**Copyright (c) 2025 plex**

版权人字符串取自该仓库上游 `LICENSE` 文件的逐字内容（经 `cdn.jsdelivr.net` 镜像取得）。

> **注意**：本节与第 2 节是**两个不同版权人**的独立许可。插件内部以两个独立的 `licenseId`
> （`MIT` 与 `MIT-plexpt`）区分它们，界面按源分别呈现——**不得**把任一源的署名写成另一个项目的版权人。

### MIT License（PlexPt/awesome-chatgpt-prompts-zh）

```
MIT License

Copyright (c) 2025 plex

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 4. 用户自定义源

用户在「源管理」中添加的第三方 JSON 源，其许可与署名责任由用户自行确认。
插件对未知许可的源以 `UNKNOWN` 标记，**不臆造版权人**，并在界面上如实显示。

---

## 5. 修改或再分发本插件时

1. **保留**本文件与 [LICENSE](LICENSE)。
2. 若移除或替换内置源，请一并更新本文件与界面的「许可与署名」。
3. **不要**把两个 MIT 源的署名混用（见第 3 节的注意）。
4. 内置源 URL 请走 `cdn.jsdelivr.net`：`raw.githubusercontent.com` 在部分网络环境不可达。
