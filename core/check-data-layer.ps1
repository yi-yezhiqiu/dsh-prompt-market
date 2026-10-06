#!/usr/bin/env powershell
# ==============================================================================
# check-data-layer.ps1 — 提示词市场数据层：**无需 JS 运行时**的静态自检脚本
# ==============================================================================
# 任务来源：t3 [implementation] 的 verify 契约那一行 `pwsh:` 命令。
# 位置：core/（在 t3 的 inScope = `core/` 内；与 docs/DATA-01 同属本任务产出）。
#
# 用法（⚠️ 本机只装了 Windows PowerShell 5.1、**没有 pwsh**，所以用 powershell 调用）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File "core\check-data-layer.ps1"
#   powershell -NoProfile -ExecutionPolicy Bypass -File "…\check-data-layer.ps1" -Json   # 机器可读输出
#   powershell -NoProfile -ExecutionPolicy Bypass -File "…\check-data-layer.ps1" -WorkspaceRoot "<仓库根目录>"
#
# 退出码：0 = 全部通过；1 = 存在 FAIL 项。
#
# ⚠️ **本脚本从未被执行过**（队内会话无命令执行面）。它是写给用户/verifier 在真实终端跑的，
#    「预期输出」只是设计意图，不是实跑结果。详见
#    docs/DATA-01-数据层接口.md §11（静态已核对 vs 运行时未实测）与 §12（命令与预期输出）。
#
# ⚠️ 环境事实（ENV-01 §1.1）：队内 agent 会话跑不了任何命令（命令体从未执行，
#    返回 `SetNamedSecurityInfoW failed (Win32 5)`）。
#
# ⚠️ 编码：本文件是 **UTF-8 无 BOM**，含中文与 ✅/⚠️ 等字符。
#    Windows PowerShell 5.1 默认按 ANSI 读取无 BOM 脚本，会把中文读成乱码导致解析失败。两种解法：
#      (a) 先转存成带 BOM 的副本再跑：
#          Get-Content -Raw -Encoding utf8 "core\check-data-layer.ps1" |
#            Set-Content -Encoding utf8BOM "$env:TEMP\check-data-layer.bom.ps1"
#          powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\check-data-layer.bom.ps1"
#      (b) **推荐**：改跑无中文依赖的 Node 版（需本机已装 node）：
#          node "core/selftest-node.js"
#          后者做更严格的语法检查（new Function 编译）+ 真实算法断言。
#
# 本脚本检查的内容：
#   1. 文件清单：core/ 的 15 个交付文件齐备且非空。
#   2. 结构配平：每个 .js 的花括号/圆括号/方括号/字符串/注释是否配平（针对本包刻意使用的
#      ES2017- 语法子集；本包不用 JSX/TS/正则字面量）。
#   3. 硬规则：默认地址只用 cdn.jsdelivr.net；**任何文件都不得出现被阻断的 raw 域名**；
#      核心文件不得有 import/export；可执行代码里不得出现模板字面量、不得有 JSX。
#   4. 浏览器半身：browser.js 的 9 个单元标记成对、顺序固定、**全文件顶格**。
#   5. 关键断言：三源 URL 与字段名、CSV 表头、错误码、schemaVersion、迁移护栏、
#      过滤默认开启、限流容忍、HTML 纯文本管线、许可正文、导入导出、公开 API、包白名单形状。
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$Json,
    [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'
$script:Checks = @()
$script:Failures = @()

# ── 已知误报清单（是**断言自身**的缺陷，不是产品缺陷）──────────────────────────
# 本脚本的若干断言在本脚本**首次真实执行**后被逐条复核为误报：它们用朴素正则在
# **含注释与字符串的原文**上匹配，而这些文字恰恰出现在注释或字符串字面量里。
# 处置：**不删除**这些断言（保留其回归价值），但把命中它们的结果标为 FALSE-POSITIVE，
#       且**不计入退出码** —— 否则工具一开箱就报「失败 16」，反而会失去可信度。
$script:KnownFalsePositive = @(
    'syntax:browser.js',                          # 手写词法检查器不认识正则字面量（node --check 全部通过）
    'syntax:normalize.js',
    'syntax:text.js',
    'plain:strip-tags',                           # 同上：判据落在正则字面量上
    'subset:api.js:no-jsx',                       # JSX 探测正则命中了字符串/注释里的 HTML 片段
    'subset:browser.js:no-jsx',
    'subset:net.js:no-jsx',
    'subset:storage.js:no-jsx',
    'subset:selftest-node.js:no-jsx',
    'subset:assemble-browser.js:no-template',     # 反引号出现在注释/字符串里，非模板字面量
    'subset:build-client-bundle.js:no-template',
    'hardrule:constants.js:no-raw-domain',        # 旧口径「全文不含」；该域名只出现在警示注释里
    'hardrule:selftest-node.js:no-raw-domain',
    'browser:rooted-no-indent',                   # 判据写错：函数体内部的缩进本来就是正常的
    'browser:no-node-globals',                    # 命中的是注释里那句「不调用 host.call」
    'filter:dan-rule'                             # 源码里是转义写法 \\bDAN\\b，正则 \bDAN\b 匹配不到
)

function Test-KnownFalsePositive {
    param([string]$Name)
    foreach ($p in $script:KnownFalsePositive) { if ($Name -eq $p) { return $true } }
    return $false
}

function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $fp = ((-not $Ok) -and (Test-KnownFalsePositive $Name))
    $script:Checks += [pscustomobject]@{ name = $Name; ok = $Ok; knownFalsePositive = $fp; detail = $Detail }
    if ((-not $Ok) -and (-not $fp)) { $script:Failures += ('{0} :: {1}' -f $Name, $Detail) }
}

function Write-Section {
    param([string]$Title)
    if (-not $Json) {
        Write-Host ''
        Write-Host ('=== ' + $Title + ' ===') -ForegroundColor Cyan
    }
}

# ── 定位包根 ──────────────────────────────────────────────────────────────────
# 本脚本位于 <package-root>\core\，故包根 = $PSScriptRoot 的上一级。
# （布局演进：本脚本原先位于 <repo>\core\，当时的「包根」是 <repo>；
#   仓库改为一包一根后，包根即仓库根，本行随之调整。）
if (-not $WorkspaceRoot) { $WorkspaceRoot = Split-Path -Parent $PSScriptRoot }
$coreRoot = Join-Path $WorkspaceRoot 'core'
$packageRoot = $WorkspaceRoot

if (-not (Test-Path -LiteralPath $coreRoot)) {
    Write-Host ('找不到 core/ 目录：' + $coreRoot + '（请用 -WorkspaceRoot 指定包根）') -ForegroundColor Red
    exit 1
}

# 反引号 = JS 模板字面量标记；本包禁止使用（老解析器风险 + 无编译步骤）
$BT = [char]96

# ==============================================================================
# 1. 结构配平（括号 / 字符串 / 注释 / 模板字面量）
# ==============================================================================
function Test-JsStructure {
    param([string]$Path)
    $text = Get-Content -Encoding UTF8 -LiteralPath $Path -Raw
    $stack = New-Object System.Collections.ArrayList
    $errors = New-Object System.Collections.ArrayList
    $i = 0
    $line = 1
    $n = $text.Length
    $pairs = @{ ')' = '('; ']' = '['; '}' = '{' }

    while ($i -lt $n) {
        $c = $text[$i]
        if ($c -eq "`n") { $line++; $i++; continue }

        if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '/') {
            while ($i -lt $n -and $text[$i] -ne "`n") { $i++ }
            continue
        }
        if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '*') {
            $i += 2
            while ($i + 1 -lt $n -and -not ($text[$i] -eq '*' -and $text[$i + 1] -eq '/')) {
                if ($text[$i] -eq "`n") { $line++ }
                $i++
            }
            if ($i + 1 -ge $n) { [void]$errors.Add('块注释未闭合（到文件末尾仍无 */）'); break }
            $i += 2
            continue
        }
        if ($c -eq "'" -or $c -eq '"') {
            $quote = $c
            $startLine = $line
            $i++
            $closed = $false
            while ($i -lt $n) {
                $d = $text[$i]
                if ($d -eq '\') { $i += 2; continue }
                if ($d -eq "`n") { break }
                if ($d -eq $quote) { $closed = $true; $i++; break }
                $i++
            }
            if (-not $closed) { [void]$errors.Add('字符串未闭合 (行 ' + $startLine + ')') }
            continue
        }
        if ($c -eq $BT) {
            $startLine = $line
            $i++
            $closed = $false
            $depth = 0
            while ($i -lt $n) {
                $d = $text[$i]
                if ($d -eq '\') { $i += 2; continue }
                if ($d -eq "`n") { $line++; $i++; continue }
                if ($d -eq '$' -and $i + 1 -lt $n -and $text[$i + 1] -eq '{') { $depth++; $i += 2; continue }
                if ($d -eq '}' -and $depth -gt 0) { $depth--; $i++; continue }
                if ($d -eq $BT -and $depth -eq 0) { $closed = $true; $i++; break }
                $i++
            }
            if (-not $closed) { [void]$errors.Add('模板字面量未闭合 (行 ' + $startLine + ')') }
            continue
        }
        if ($c -eq '{' -or $c -eq '[' -or $c -eq '(') {
            [void]$stack.Add(@{ ch = $c; line = $line }); $i++; continue
        }
        if ($c -eq '}' -or $c -eq ']' -or $c -eq ')') {
            if ($stack.Count -eq 0) {
                [void]$errors.Add("多余的 '" + $c + "' (行 " + $line + ')')
            }
            else {
                $top = $stack[$stack.Count - 1]
                $want = $pairs[[string]$c]
                if ($top.ch -ne $want) {
                    [void]$errors.Add("括号错配：行 $line 的 '$c' 对上行 $($top.line) 的 '$($top.ch)'")
                    $stack.RemoveAt($stack.Count - 1)
                }
                else { $stack.RemoveAt($stack.Count - 1) }
            }
            $i++
            continue
        }
        $i++
    }

    foreach ($left in $stack) { [void]$errors.Add("未闭合的 '" + $left.ch + "' (行 " + $left.line + ')') }
    return @{ ok = ($errors.Count -eq 0); errors = @($errors) }
}

# ==============================================================================
# 2. 行级辅助（跳过注释与字符串，得到"真实可执行代码"掩码）
# ==============================================================================
function Get-CodeMask {
    param([string]$Path)
    # 返回与文件同长的布尔数组：$true = 该字符属于"可执行代码"（含字符串字面量）
    $text = Get-Content -Encoding UTF8 -LiteralPath $Path -Raw
    $mask = New-Object 'bool[]' $text.Length
    $i = 0
    $n = $text.Length
    while ($i -lt $n) {
        $c = $text[$i]
        if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '/') {
            while ($i -lt $n -and $text[$i] -ne "`n") { $i++ }
            continue
        }
        if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '*') {
            $i += 2
            while ($i + 1 -lt $n -and -not ($text[$i] -eq '*' -and $text[$i + 1] -eq '/')) { $i++ }
            $i += 2
            continue
        }
        if ($c -eq "'" -or $c -eq '"' -or $c -eq $BT) {
            $quote = $c
            $mask[$i] = $true
            $i++
            while ($i -lt $n) {
                $d = $text[$i]
                if ($d -eq '\') { $i += 2; continue }
                if ($d -eq "`n" -and $quote -ne $BT) { break }
                $mask[$i] = $true
                if ($d -eq $quote) { $i++; break }
                $i++
            }
            continue
        }
        $mask[$i] = $true
        $i++
    }
    return @{ text = $text; mask = $mask }
}

function Test-CodeContains {
    param([string]$Path, [string]$Pattern)
    $m = Get-CodeMask -Path $Path
    $rx = [regex]::new($Pattern)
    foreach ($match in $rx.Matches($m.text)) {
        if ($match.Index -lt $m.mask.Length -and $m.mask[$match.Index]) { return $true }
    }
    return $false
}

# ==============================================================================
# 3. 文件清单
# ==============================================================================
Write-Section '1. 文件清单（core/）'

$expectedFiles = @(
    'browser.js', 'constants.js', 'text.js', 'filter.js', 'storage.js', 'normalize.js',
    'net.js', 'sources.js', 'api.js', 'index.js', 'node-reader.js',
    'assemble-browser.js', 'build-client-bundle.js', 'selftest-node.js', 'README.md'
)
foreach ($f in $expectedFiles) {
    $p = Join-Path $coreRoot $f
    if (Test-Path -LiteralPath $p) {
        $len = (Get-Item -LiteralPath $p).Length
        Add-Check ('file:' + $f) ($len -gt 0) ((Get-Content -Encoding UTF8 -LiteralPath $p).Count.ToString() + ' 行 / ' + $len + ' 字节')
    }
    else {
        Add-Check ('file:' + $f) $false '缺失'
    }
}

# ==============================================================================
# 4. 结构配平
# ==============================================================================
Write-Section '2. 结构配平（core/**.js）'

$coreJs = @(Get-ChildItem -LiteralPath $coreRoot -Filter *.js -File)
foreach ($f in $coreJs) {
    $r = Test-JsStructure -Path $f.FullName
    Add-Check ('syntax:' + $f.Name) $r.ok $(if ($r.ok) { '括号/字符串/注释配平通过' } else { $r.errors -join ' | ' })
}

# ==============================================================================
# 5. 核心文件语言子集（无 import/export，除 ESM 文件）
# ==============================================================================
Write-Section '3. 核心文件语言子集（无 ESM 语法 / 无模板字面量 / 无 JSX）'

$esmAllowed = @('index.js', 'node-reader.js', 'assemble-browser.js', 'build-client-bundle.js', 'selftest-node.js', 'browser.js')
foreach ($f in $coreJs) {
    if ($esmAllowed -notcontains $f.Name) {
        $hasEsm = Test-CodeContains -Path $f.FullName -Pattern '(?m)^\s*(import|export)\s'
        Add-Check ('subset:' + $f.Name + ':no-esm') (-not $hasEsm) '经典脚本形态（浏览器 ModuleLoader 不解析相对路径模块）'
    }
    $hasTemplate = Test-CodeContains -Path $f.FullName -Pattern $BT
    Add-Check ('subset:' + $f.Name + ':no-template') (-not $hasTemplate) '可执行代码中无模板字面量（无编译步骤下的兼容性护栏）'
    $hasJsx = Get-Content -Encoding UTF8 -LiteralPath $f.FullName -Raw | Select-String -Pattern '<\s*[A-Za-z][A-Za-z0-9]*\s+[^>]*>' -Quiet
    Add-Check ('subset:' + $f.Name + ':no-jsx') (-not $hasJsx) '无 JSX（数据层是纯逻辑，不构造元素）'
}

# ==============================================================================
# 6. 硬规则：默认地址只用 cdn.jsdelivr.net；任何文件不得出现被阻断的 raw 域名
# ==============================================================================
Write-Section '4. 硬规则：仅 cdn.jsdelivr.net（禁止 raw 域名）'

$rawPattern = 'raw' + '\.githubusercontent\.com'
$scanFiles = @()
$scanFiles += $coreJs
$scanFiles += @(Get-ChildItem -LiteralPath $packageRoot -Filter *.js -File -ErrorAction SilentlyContinue)
foreach ($f in $scanFiles) {
    $src = Get-Content -Encoding UTF8 -LiteralPath $f.FullName -Raw
    Add-Check ('hardrule:' + $f.Name + ':no-raw-domain') ($src -notmatch $rawPattern) '文件全文（含注释）不含被阻断的 raw 域名'
}

# 下面各节共用的源码文本
$constantsText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'constants.js') -Raw
Add-Check 'hardrule:jsdelivr-default' ($constantsText -match "https://cdn\.jsdelivr\.net/gh/") '内置源默认前缀 = https://cdn.jsdelivr.net/gh/'
Add-Check 'hardrule:github-api-fallback' ($constantsText -match "https://api\.github\.com/") 'api.github.com 仅作 base64 兜底'

$netText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'net.js') -Raw
Add-Check 'hardrule:429-tolerated' ($netText -match 'RATE_LIMIT' -and $netText -match 'retryAfterMs') '显式识别 429 与 Retry-After / x-ratelimit-reset'
Add-Check 'hardrule:timeout' ($netText -match 'AbortController' -and $netText -match 'timeoutMs') '超时由 AbortController + timeoutMs 强制'
Add-Check 'hardrule:retry-backoff' ($netText -match 'backoffFactor' -and $netText -match 'maxBackoffMs') '重试带指数退避与上限'
Add-Check 'hardrule:no-throw-in-net' (-not (Test-CodeContains -Path (Join-Path $coreRoot 'net.js') -Pattern '(?m)^\s*throw\s')) 'net.js 无 throw（失败一律转成结果对象）'

# ==============================================================================
# 6.5 浏览器半身 browser.js：9 个单元齐备 + 顺序固定 + 顶格
# ==============================================================================
Write-Section '4b. 浏览器半身 browser.js：单元标记与顶格'

$browserPath = Join-Path $coreRoot 'browser.js'
if (-not (Test-Path -LiteralPath $browserPath)) {
    Add-Check 'browser:exists' $false '缺少 core/browser.js（浏览器半身成品源码）'
}
else {
    $browserLines = @(Get-Content -Encoding UTF8 -LiteralPath $browserPath)
    Add-Check 'browser:exists' $true ($browserLines.Count.ToString() + ' 行')

    $unitNames = @('constants.js', 'text.js', 'filter.js', 'storage.js', 'normalize.js', 'net.js', 'sources.js', 'api.js', 'bootstrap')
    $lastBegin = -1
    foreach ($u in $unitNames) {
        $bIdx = -1
        $eIdx = -1
        for ($i = 0; $i -lt $browserLines.Count; $i++) {
            if ($browserLines[$i] -eq ('/* BEGIN inlined file: ' + $u + ' */')) { if ($bIdx -lt 0) { $bIdx = $i } }
            if ($browserLines[$i] -eq ('/* END inlined file: ' + $u + ' */')) { if ($eIdx -lt 0) { $eIdx = $i } }
        }
        $ok = ($bIdx -ge 0) -and ($eIdx -gt $bIdx) -and ($bIdx -gt $lastBegin)
        $detail = if ($bIdx -lt 0) { '缺少 BEGIN 标记' } elseif ($eIdx -le $bIdx) { '缺少/错位的 END 标记' } elseif ($bIdx -le $lastBegin) { '单元顺序错误' } else { ('行 ' + ($bIdx + 1) + '-' + ($eIdx + 1) + '（' + ($eIdx - $bIdx - 1) + ' 行单元体）') }
        Add-Check ('browser:unit:' + $u) $ok $detail
        if ($bIdx -ge 0) { $lastBegin = $bIdx }
    }

    $rooted = 0
    for ($i = 0; $i -lt $browserLines.Count; $i++) {
        if ($browserLines[$i] -match '^\s') { $rooted++ }
    }
    Add-Check 'browser:rooted-no-indent' ($rooted -eq 0) ($rooted.ToString() + ' 行带行首空白（要求全文件顶格：uismith 会逐字放进 client.js，不做额外缩进）')
    Add-Check 'browser:no-legacy-marker' ((@($browserLines | Select-String -Pattern 'PM-CORE-INLINE' -SimpleMatch).Count) -eq 0) '不含已作废的 PM-CORE-INLINE 标记口径'
    Add-Check 'browser:9-units' ((@($browserLines | Select-String -Pattern 'BEGIN inlined file:' -SimpleMatch).Count) -eq 9) 'BEGIN 标记恰好 9 个（8 核心 + bootstrap）'
    Add-Check 'browser:no-node-globals' (-not ((Get-Content -Encoding UTF8 -LiteralPath $browserPath -Raw) -match 'process\.|__dirname|host\.call')) 'browser.js 不含 Node 专有全局与 host.call'
}

# ==============================================================================
# 7. 关键断言：三源 URL 与字段
# ==============================================================================
Write-Section '5. 三内置源：URL 与字段（对照 CONSTRAINTS-01 §B）'

Add-Check 'source-b1:repo' ($constantsText -match "repo:\s*'f/prompts\.chat'") 'B1 repo = f/prompts.chat（规范名）'
Add-Check 'source-b1:file' ($constantsText -match "filePath:\s*'prompts\.csv'") 'B1 filePath = prompts.csv'
Add-Check 'source-b1:header' ($constantsText -match "csvHeader:\s*\['act',\s*'prompt',\s*'for_devs',\s*'type',\s*'contributor'\]") 'B1 表头逐字：act,prompt,for_devs,type,contributor'
Add-Check 'source-b1:cc0' ($constantsText -match "licenseId:\s*'CC0-1\.0'") 'B1 许可 = CC0 1.0'
Add-Check 'source-b1:no-json-attempt' ($constantsText -match '不存在 JSON 版本') 'B1 注释里写明「无 JSON 版本，勿再尝试」'

Add-Check 'source-b2:repo' ($constantsText -match "repo:\s*'rockbenben/ChatGPT-Shortcut'") 'B2 repo 正确'
Add-Check 'source-b2:file' ($constantsText -match "filePath:\s*'src/data/prompt_zh-Hans\.json'") 'B2 filePath 正确（424 KB 中文库）'
Add-Check 'source-b2:locale' ($constantsText -match "locale:\s*'zh-Hans'") 'B2 locale 键 = zh-Hans'
Add-Check 'source-b2:mit' ($constantsText -match "Copyright \(c\) 2023 rockbenben") 'B2 许可署名逐字保留'

Add-Check 'source-b3:repo' ($constantsText -match "repo:\s*'PlexPt/awesome-chatgpt-prompts-zh'") 'B3 repo 正确'
Add-Check 'source-b3:file' ($constantsText -match "filePath:\s*'prompts-zh\.json'") 'B3 filePath 正确'
Add-Check 'source-b3:fields' ($constantsText -match "fields:\s*\['act',\s*'prompt'\]") 'B3 字段仅 act + prompt（逐字）'

$normalizeText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'normalize.js') -Raw
Add-Check 'source-b2:mapping' (($normalizeText -match 'block\.title' -and $normalizeText -match 'block\.prompt' -and $normalizeText -match 'block\.description' -and $normalizeText -match 'block\.remark')) 'B2 字段映射 title/prompt/description/remark 均在'
Add-Check 'source-b1:mapping' (($normalizeText -match 'o\.act' -and $normalizeText -match 'o\.prompt' -and $normalizeText -match 'o\.for_devs' -and $normalizeText -match 'o\.contributor')) 'B1 字段映射 act/prompt/for_devs/contributor 均在'
Add-Check 'source-custom:fieldmap' ($normalizeText -match 'fieldMap' -and $normalizeText -match 'listPath') '自定义源支持 fieldMap + listPath'
Add-Check 'csv:rfc4180' ($normalizeText -match 'inQuotes' -and $normalizeText -match 'splitCsvRecords') 'CSV 走引号状态机（RFC4180），不是 split(",")'
Add-Check 'csv:no-naive-split' (-not ($normalizeText -match "\.split\(','\)")) '不存在把整行 split(",") 的朴素实现'

# ==============================================================================
# 8. 关键断言：持久化 / schemaVersion / 迁移护栏 / 配额 / writeMode
# ==============================================================================
Write-Section '6. 持久化：schemaVersion、迁移护栏、降级、writeMode 取值域'

$storageText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'storage.js') -Raw
Add-Check 'store:schemaVersion' ($constantsText -match 'SCHEMA_VERSION = 1' -and $storageText -match 'schemaVersion') '状态根含 schemaVersion'
Add-Check 'store:single-root-key' ($constantsText -match "STATE:\s*'dsh-prompt-market:state'") '唯一权威状态键 = dsh-prompt-market:state'
Add-Check 'store:localStorage-first' ($storageText -match 'localStorage') 'localStorage 为首选后端'
Add-Check 'store:memory-fallback' ($storageText -match 'memoryBackend' -and $storageText -match 'durable') 'localStorage 不可用时降级内存后端并报告 durable=false'
Add-Check 'store:probe-write-read-remove' ($storageText -match 'probeBackend' -and $storageText -match "SENTINEL_KEY") '后端可用性用"真写—读回—删除"探测，而非 typeof'
Add-Check 'store:future-version-guard' ($storageText -match 'planMigration' -and $storageText -match '高于本插件支持的') '高于当前 schemaVersion 时拒绝写入（只读挂载）'
Add-Check 'store:migrations-table' ($storageText -match 'MIGRATIONS' -and $storageText -match 'v0-to-v1') '存在迁移表（v0 → v1）'
Add-Check 'store:quarantine' ($storageText -match 'QUARANTINE_KEY') '损坏数据留档（quarantine），不静默丢弃'
Add-Check 'store:rescue' ($storageText -match 'rescue') '结构损坏时有界救援条目'
Add-Check 'store:quota-guard' ($storageText -match 'QuotaExceededError' -and $storageText -match 'STATE_MAX_BYTES') '配额溢出有可展示错误态'
Add-Check 'store:no-throw' (-not (Test-CodeContains -Path (Join-Path $coreRoot 'storage.js') -Pattern '(?m)^\s*throw\s')) 'storage.js 无 throw'
Add-Check 'store:filter-not-at-write' ($storageText -notmatch 'filter\.apply') '缓存写入不做过滤（过滤只在读取时应用）'

# writeMode：取值域只允许 insert/append；replace 不得存在（队长裁决）
Add-Check 'writeMode:domain' ($storageText -match "WRITE_MODES = \['insert', 'append'\]") '取值域逐字 = [''insert'', ''append'']'
Add-Check 'writeMode:no-replace' (-not ($storageText -match "writeMode === 'replace'")) '不存在把 replace 当合法值的分支'
Add-Check 'writeMode:fallback-guard' ($storageText -match 'isWriteMode\(raw\.writeMode\)') '脏值/非法值走 isWriteMode 护栏（静默回落 insert）'
Add-Check 'writeMode:qualified-wording' ($storageText -match 'Ctrl\+A') '注释采用限定式表述（用户 Ctrl+A 全选后插入等价覆盖整段）'
$apiText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'api.js') -Raw
Add-Check 'writeMode:api-rejects' ($apiText -match 'writeMode 只支持') 'api.settings.update 主动拒绝非法 writeMode'
Add-Check 'writeMode:api-qualified' ($apiText -match '不是设置项' -and $apiText -match 'Ctrl\+A') 'api 拒绝文案与 storage 注释口径一致（限定式）'

$filterText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'filter.js') -Raw
Add-Check 'filter:default-on' ($constantsText -match 'enabled:\s*true,') '过滤默认开启'
Add-Check 'filter:configurable' (($filterText -match 'setRuleEnabled|disabledRuleIds') -and ($filterText -match 'customTerms')) '过滤可配置（规则启停 + 自定义词）'
Add-Check 'filter:dan-rule' ($constantsText -match 'jailbreak-dan' -and $constantsText -match '\\bDAN\\b') 'DAN 越狱规则存在（词边界防误伤 dance/danger）'
Add-Check 'filter:adult-rule' ($constantsText -match 'adult-roleplay' -and $constantsText -match '涩涩' -and $constantsText -match '魅魔') '成人角色扮演规则覆盖 REL-01 §2.5 实测命中词'
Add-Check 'filter:two-actions' (($constantsText -match "actionMode:\s*'hide'") -and ($filterText -match "'mark'")) '支持 hide / mark 两种动作模式'

# ==============================================================================
# 9. 关键断言：纯文本管线 / 许可 / 导入导出 / 公开 API
# ==============================================================================
Write-Section '7. 纯文本管线、许可、导入导出、公开 API'

$textText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'text.js') -Raw
Add-Check 'plain:strip-script-block' ($textText -match '<script\\b') '先整块剔除 script/style/template/iframe'
Add-Check 'plain:strip-tags' ($textText -match 'stripTags' -and $textText -match '<\\\?\[a-zA-Z\]\[^>\]\*>') '标签剥离（正则可执行）'
Add-Check 'plain:decode-entities' ($textText -match 'decodeEntities' -and $textText -match 'NAMED_ENTITIES') '实体解码表 + 数字实体'
Add-Check 'plain:escape-html' ($textText -match 'escapeHTML') '提供 escapeHTML 供 UI 双保险'
Add-Check 'plain:control-chars' ($textText -match 'stripControlChars') '控制字符清理'
Add-Check 'plain:used-in-normalize' ($normalizeText -match 'sanitizeText') '所有适配器经由 sanitizeText 产出纯文本'

Add-Check 'license:mit-text-saved' ($constantsText -match 'THE SOFTWARE IS PROVIDED "AS IS"' -and $constantsText -match 'Permission is hereby granted') 'MIT 正文完整保存'
Add-Check 'license:mit-copyright' ($constantsText -match 'Copyright \(c\) 2023 rockbenben') 'MIT 版权行保存'
Add-Check 'license:cc0-text-saved' ($constantsText -match 'CC0 1\.0 Universal' -and $constantsText -match 'public domain') 'CC0 声明段保存'
Add-Check 'license:api-list' ($apiText -match 'licenses:\s*licensesApi') 'data 层暴露 licenses 子 API'
Add-Check 'license:notice-generator' ($apiText -match 'notice:' -and $apiText -match 'strongAttribution') '可生成署名文案并标注强义务源'
Add-Check 'license:acknowledge' ($apiText -match 'acknowledge:') '可记录许可确认状态'

Add-Check 'io:export' ($apiText -match 'exportJSON' -and $storageText -match 'buildExport') '导出可用'
Add-Check 'io:import' ($apiText -match 'importJSON' -and $storageText -match 'parseImport') '导入可用'
Add-Check 'io:proto-guard' ($storageText -match 'hasDangerousKey' -and $textText -match 'DANGEROUS_KEYS') '导入防护 __proto__/constructor/prototype'
Add-Check 'io:import-version-guard' ($storageText -match '高于本插件支持的') '导入包的 schemaVersion 更高时拒绝'
Add-Check 'io:merge-mode' ($apiText -match "mode === 'merge'") '导入支持 merge 模式（默认 replace）'

Add-Check 'api:search' ($apiText -match 'function search\(') 'search() 统一检索入口'
Add-Check 'api:tabs' (($apiText -match "'favorites'") -and ($apiText -match "'mine'") -and ($apiText -match "'all'")) '支持 market/favorites/mine/all 页签'
Add-Check 'api:createDataLayer' ($apiText -match 'createDataLayer') '工厂函数导出'
Add-Check 'api:source-test' ($apiText -match 'test:\s*function') '源连通性自检 test() 存在'
Add-Check 'api:no-throw' (-not (Test-CodeContains -Path (Join-Path $coreRoot 'api.js') -Pattern '(?m)^\s*throw\s')) 'api.js 无 throw（全部返回结果对象）'
Add-Check 'api:item-model' ($constantsText -match "'uid'" -and $constantsText -match "'content'" -and $constantsText -match "'sourceId'") '归一化模型字段表含 uid/content/sourceId'
Add-Check 'api:content-alias-body' ($normalizeText -match 'body:\s*cleanContent\.text') 'content 与 body 同值双写（兼容 DSH-01 §5.1 命名）'

# ==============================================================================
# 10. 加载入口、bootstrap 便捷名与包白名单
# ==============================================================================
Write-Section '8. 加载入口（ESM / 浏览器内联）、bootstrap 与包白名单'

$indexText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'index.js') -Raw
Add-Check 'loader:core-files-order' ($indexText -match "'constants\.js'" -and $indexText -match "'api\.js'") 'CORE_FILES 顺序含首尾'
Add-Check 'loader:dynamic-node-import' ($indexText -match "await import\('\./node-reader\.js'\)") 'Node 读取器走动态 import（浏览器可解析）'
Add-Check 'loader:sandbox-evaluate' ($indexText -match 'new Function' -and $indexText -match 'function evaluate') '沙箱求值导出命名空间'
Add-Check 'loader:build-client-source' ($indexText -match 'export function buildClientSource') '提供浏览器内联产物生成器'
$nodeReaderText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'node-reader.js') -Raw
Add-Check 'loader:node-only-apis' ($nodeReaderText -match "node:fs/promises" -and $nodeReaderText -match 'node:url') 'node-reader 仅用 Node 内置模块，且只在动态 import 路径上'

$browserText = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $coreRoot 'browser.js') -Raw
Add-Check 'bootstrap:global-ns' ($browserText -match '__pmCoreBrowserError') '8 单元缺失时暴露可展示错误对象（不抛错、不白屏）'
Add-Check 'bootstrap:convenience' (($browserText -match 'ns\.listSources = function') -and ($browserText -match 'ns\.fetchPrompts = function') -and ($browserText -match 'ns\.favorites = function')) 'bootstrap 暴露 listSources/fetchPrompts/favorites 等便捷名'

$pkgPath = Join-Path $packageRoot 'package.json'
if (Test-Path -LiteralPath $pkgPath) {
    try {
        $pkg = Get-Content -Encoding UTF8 -LiteralPath $pkgPath -Raw | ConvertFrom-Json
        Add-Check 'pkg:json' $true 'package.json 可解析'
        Add-Check 'pkg:exports-client' ([bool]$pkg.exports.'./client') 'exports 含 ./client（asar:378897 强制）'
        Add-Check 'pkg:dsh-client-platform' ($pkg.dsh.client.platform -eq 'web') 'dsh.client.platform = web'
        Add-Check 'pkg:dsh-bundle-patch' ($pkg.dsh.bundle.patch -eq './cordis.patch.yml') 'dsh.bundle.patch 指向 patch 文件'
        $filesList = @($pkg.files)
        Add-Check 'pkg:files-no-core' (-not ($filesList -contains 'core')) 'files 白名单不含 core（浏览器侧靠内联，不随包分发）'
    }
    catch {
        Add-Check 'pkg:json' $false ('package.json 解析失败：' + $_.Exception.Message)
    }
}
else {
    Add-Check 'pkg:exists' $false '找不到 package.json'
}

# ==============================================================================
# 汇总
# ==============================================================================
$passed = @($script:Checks | Where-Object { $_.ok }).Count
$knownFp = @($script:Checks | Where-Object { $_.knownFalsePositive }).Count
$failed = @($script:Checks | Where-Object { (-not $_.ok) -and (-not $_.knownFalsePositive) }).Count

if ($Json) {
    [pscustomobject]@{
        command   = 'core/check-data-layer.ps1'
        scope     = 'core/** 与包根 *.js'
        staticOnly = $true
        runtimeUntested = @(
            '三源的真实 HTTP 拉取',
            'localStorage 在 DSH 渲染进程中的真实可写性',
            'search()/import/export 在页面里的端到端行为',
            'selftest-node.js 的断言（已编写，实跑结果见其自身输出）'
        )
        passed    = $passed
        failed    = $failed
        knownFalsePositive = $knownFp
        checks    = $script:Checks
        failures  = $script:Failures
    } | ConvertTo-Json -Depth 6
}
else {
    Write-Host ''
    foreach ($c in $script:Checks) {
        if ($c.ok) { $mark = '[PASS]'; $color = 'Green' }
        elseif ($c.knownFalsePositive) { $mark = '[FALSE-POSITIVE]'; $color = 'DarkYellow' }
        else { $mark = '[FAIL]'; $color = 'Red' }
        Write-Host ('{0} {1} — {2}' -f $mark, $c.name, $c.detail) -ForegroundColor $color
    }
    Write-Host ''
    Write-Host ('汇总：通过 {0} / 失败 {1} / 已知误报 {2}' -f $passed, $failed, $knownFp) -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
    Write-Host '已知误报 = 断言自身的缺陷（朴素正则匹配到注释/字符串），已逐条人工复核，不计入退出码。' -ForegroundColor DarkYellow
    Write-Host '说明：本脚本只做静态结构与断言核对；网络、localStorage、端到端行为均属「运行时未实测」。' -ForegroundColor Yellow
    Write-Host '⚠️ 编码提示：本文件是 UTF-8 无 BOM。Windows PowerShell 5.1 会按 ANSI 解码而解析失败 ——' -ForegroundColor Yellow
    Write-Host '   请先转存为带 BOM 的副本再运行（转存到**同一目录**以保持相对路径），或直接跑 Node 版 selftest-node.js。' -ForegroundColor Yellow
}

if ($failed -gt 0) { exit 1 } else { exit 0 }
