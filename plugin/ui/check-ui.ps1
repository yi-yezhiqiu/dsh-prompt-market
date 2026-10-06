<#
  check-ui.ps1 - static self-check for the prompt-market UI units (task t4 / uismith).

  NO JavaScript runtime is needed. This script only reads files and checks structure,
  forbidden patterns and cross-unit contracts. It NEVER runs the plugin.

  Run with Windows PowerShell 5.1 (this machine has no pwsh):
      powershell -NoProfile -ExecutionPolicy Bypass -File "<this file>"
      powershell -NoProfile -ExecutionPolicy Bypass -File "<this file>" -Json

  Exit code: 0 = every FAIL-level check passed; 1 = at least one FAIL-level check failed.

  IMPORTANT (honesty rule):
    "static verified" IS NOT "runtime verified".
    Everything below is static evidence only. Runtime facts (button actually visible,
    draft really written, Ctrl+Z undoable, persistence across restart, offline degrade)
    are NOT verified here - they belong to the user acceptance gate (t8).

  ASCII-only on purpose: PowerShell 5.1 decodes a BOM-less .ps1 as ANSI.
#>
param([switch]$Json)

$ErrorActionPreference = 'Stop'

$uiDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDir = Split-Path -Parent $uiDir
$coreFile  = Join-Path $pluginDir 'core\browser.js'
$clientFile = Join-Path $pluginDir 'client.js'

$results = New-Object System.Collections.ArrayList

function Add-Result([string]$id, [string]$level, [string]$message) {
  [void]$results.Add([pscustomobject]@{ id = $id; level = $level; message = $message })
}
function Pass([string]$id, [string]$m) { Add-Result $id 'PASS' $m }
function Fail([string]$id, [string]$m) { Add-Result $id 'FAIL' $m }
function Warn([string]$id, [string]$m) { Add-Result $id 'WARN' $m }
function Info([string]$id, [string]$m) { Add-Result $id 'INFO' $m }

function Read-Text([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  return (Get-Content -LiteralPath $p -Raw -Encoding UTF8)
}
function Normalize-Lines([string]$t) {
  $out = New-Object System.Collections.ArrayList
  foreach ($ln in ($t -split "`r?`n")) {
    $s = $ln.Trim()
    if ($s -ne '') { [void]$out.Add($s) }
  }
  return ,$out
}

# ---------------------------------------------------------------- target units
$unitNames = @('00-core.js','10-theme.js','20-data.js','30-write.js','40-probe.js','50-store.js','60-components.js','70-entry.js')
$unitTexts = @{}
$missing = @()
foreach ($u in $unitNames) {
  $t = Read-Text (Join-Path $uiDir $u)
  if ($null -eq $t -or $t.Trim() -eq '') { $missing += $u } else { $unitTexts[$u] = $t }
}
if ($missing.Count -gt 0) {
  Fail 'U1' ('missing or empty UI unit(s): ' + ($missing -join ', '))
} else {
  Pass 'U1' ('all ' + $unitNames.Count + ' UI units present and non-empty')
}
$ui = ($unitNames | ForEach-Object { if ($unitTexts.ContainsKey($_)) { $unitTexts[$_] } }) -join "`n"

# ---------------------------------------------------------------- A1 structure balance (WARN level: naive brace counting)
foreach ($u in $unitNames) {
  if (-not $unitTexts.ContainsKey($u)) { continue }
  $t = $unitTexts[$u]
  $ob = ([regex]::Matches($t, '\{')).Count; $cb = ([regex]::Matches($t, '\}')).Count
  $op = ([regex]::Matches($t, '\(')).Count; $cp = ([regex]::Matches($t, '\)')).Count
  if ($ob -ne $cb -or $op -ne $cp) {
    Warn 'A1' ($u + ' raw counts differ: braces ' + $ob + '/' + $cb + ', parens ' + $op + '/' + $cp + ' (strings/comments may unbalance this naive count)')
  } else {
    Pass 'A1' ($u + ' balanced raw counts: braces ' + $ob + ', parens ' + $op)
  }
}

# ---------------------------------------------------------------- A2 data layer: 9 unit regions in browser.js
$browser = Read-Text $coreFile
$expectedUnits = @('constants.js','text.js','filter.js','storage.js','normalize.js','net.js','sources.js','api.js','bootstrap')
if ($null -eq $browser) {
  Warn 'A2' 'plugin/core/browser.js not found - data layer region check skipped'
} else {
  # Only real marker LINES: `/* BEGIN inlined file: <name> */` (leading whitespace and ==== style
  # decorations tolerated). The previous unanchored pattern also matched the prose in the file
  # header (browser.js:44), which inflated the counts to 10.
  $beginRx = [regex]'(?m)^\s*/\*\s*=*\s*BEGIN inlined file:\s*([^\s*]+)\s*=*\s*\*/'
  $endRx = [regex]'(?m)^\s*/\*\s*=*\s*END inlined file:\s*([^\s*]+)\s*=*\s*\*/'
  $begin = $beginRx.Matches($browser)
  $endm = $endRx.Matches($browser)
  $bNames = @(); foreach ($m in $begin) { $bNames += $m.Groups[1].Value }
  $eNames = @(); foreach ($m in $endm) { $eNames += $m.Groups[1].Value }
  $problems = @()
  if ($bNames.Count -ne 9) { $problems += ('BEGIN count is ' + $bNames.Count + ', expected 9') }
  if ($eNames.Count -ne 9) { $problems += ('END count is ' + $eNames.Count + ', expected 9') }
  foreach ($n in $expectedUnits) {
    if ($bNames -notcontains $n) { $problems += ('missing BEGIN for ' + $n) }
    if ($eNames -notcontains $n) { $problems += ('missing END for ' + $n) }
  }
  if ($problems.Count -gt 0) { Fail 'A2' ('browser.js unit regions: ' + ($problems -join '; ')) }
  else { Pass 'A2' 'browser.js has 9 paired BEGIN/END inlined-file regions (constants.js..bootstrap)' }
}

# ---------------------------------------------------------------- code-text helper (comments out)
# Assertions that look for code patterns must not be fooled by comments or documentation text
# (e.g. plugin/ui/10-theme.js:5 documents "var(--dsw-*)" in a comment, and
#  plugin/core/browser.js:44 documents the marker syntax). Get-CodeText removes // and /* */
# comments while preserving string literals verbatim, so URLs and CSS strings stay intact.
function Get-CodeText([string]$text) {
  $out = New-Object System.Text.StringBuilder
  $n = $text.Length
  $i = 0
  while ($i -lt $n) {
    $c = $text[$i]
    $c2 = ''
    if (($i + 1) -lt $n) { $c2 = $text[$i + 1] }
    if ($c -eq '/' -and $c2 -eq '/') {
      while ($i -lt $n -and $text[$i] -ne "`n") { $i++ }
      continue
    }
    if ($c -eq '/' -and $c2 -eq '*') {
      $i += 2
      while ($i -lt $n) {
        if ($text[$i] -eq '*' -and (($i + 1) -lt $n) -and $text[$i + 1] -eq '/') { $i += 2; break }
        if ($text[$i] -eq "`n") { [void]$out.Append("`n") }
        $i++
      }
      continue
    }
    if ($c -eq "'" -or $c -eq '"') {
      $quote = $c
      [void]$out.Append($c)
      $i++
      while ($i -lt $n) {
        $d = $text[$i]
        [void]$out.Append($d)
        if ($d -eq '\') { if (($i + 1) -lt $n) { [void]$out.Append($text[$i + 1]); $i += 2; continue } }
        if ($d -eq $quote) { $i++; break }
        $i++
      }
      continue
    }
    [void]$out.Append($c)
    $i++
  }
  return $out.ToString()
}
$uiCode = Get-CodeText $ui

# ---------------------------------------------------------------- A3 theme tokens and colour discipline
$tokens = @(
  '--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-bg-layer-2','--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1','--dsw-alias-border-l2','--dsw-alias-brand-primary',
  '--dsw-alias-label-primary','--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary','--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary','--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill'
)
$badColor = @()
foreach ($m in [regex]::Matches($uiCode, '#[0-9a-fA-F]{3,8}\b')) { $badColor += $m.Value }
foreach ($m in [regex]::Matches($uiCode, '\b(rgba?|hsla?)\s*\(')) { $badColor += $m.Value }
if ($badColor.Count -gt 0) { Fail 'A3' ('hard-coded colours found: ' + (($badColor | Select-Object -First 8) -join ', ')) }
else { Pass 'A3' 'no hex/rgb/hsl colour literals in UI code (comments excluded)' }

$badToken = @()
foreach ($m in [regex]::Matches($uiCode, 'var\(\s*(--[A-Za-z0-9-]+)')) {
  $name = $m.Groups[1].Value
  if ($tokens -notcontains $name) { $badToken += $name }
}
if ($badToken.Count -gt 0) { Fail 'A3b' ('var() uses non-whitelisted token(s): ' + (($badToken | Select-Object -Unique) -join ', ')) }
else { Pass 'A3b' 'every var(--...) in UI code uses one of the 14 CONSTRAINTS-01 D tokens (comments excluded)' }

# ---------------------------------------------------------------- A4 module syntax / forbidden references
if ($uiCode -match '(?m)^\s*(import|export)\s') { Fail 'A4' 'ESM import/export statement found in UI units' }
else { Pass 'A4' 'no ESM import/export statements' }

$reqBad = @()
foreach ($m in [regex]::Matches($uiCode, "require\(\s*'([^']+)'")) { if ($m.Groups[1].Value -ne 'react') { $reqBad += $m.Groups[1].Value } }
foreach ($m in [regex]::Matches($uiCode, 'require\(\s*"([^"]+)"')) { if ($m.Groups[1].Value -ne 'react') { $reqBad += $m.Groups[1].Value } }
if ($reqBad.Count -gt 0) { Fail 'A4b' ('require() of non-baseline module(s): ' + ($reqBad -join ', ')) }
else { Pass 'A4b' "require() only requests 'react'" }

if ([regex]::IsMatch($uiCode, '<[A-Z][A-Za-z0-9]*')) { Fail 'A4c' 'JSX-like markup found (React.createElement only)' }
else { Pass 'A4c' 'no JSX-like markup in UI code (comments excluded)' }

# A5 (narrowed per captain ruling): the blocked host must not appear as a REQUESTABLE URL,
# i.e. inside a quoted address. Comment lines are ignored and self-check / fixture files
# (*selftest*, *check-*) are exempt. A5b reports the stricter "bare literal on a non-comment,
# non-fixture line" case separately: that pattern is only safe when the host is assembled at
# runtime (see plugin/ui/60-components.js PM_BLOCKED_RAW_HOST).
$urlRx = [regex]"['""]\s*(https?:)?//[^'""]*raw\.githubusercontent\.com"
$fixtureRx = [regex]'(selftest|check-)'
$urlHits = @()
$litHits = @()
foreach ($f in (Get-ChildItem -LiteralPath $pluginDir -Recurse -File -Filter *.js)) {
  if ($fixtureRx.IsMatch($f.Name)) { continue }
  $lines = @(Get-Content -LiteralPath $f.FullName -Encoding UTF8)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = [string]$lines[$i]
    $trim = $ln.TrimStart()
    if ($trim.StartsWith('//') -or $trim.StartsWith('/*') -or $trim.StartsWith('*')) { continue }
    if ($urlRx.IsMatch($ln)) { $urlHits += ($f.Name + ':' + ($i + 1)) }
    elseif ($ln -match 'raw\.githubusercontent\.com') { $litHits += ($f.Name + ':' + ($i + 1)) }
  }
}
if ($urlHits.Count -gt 0) {
  Fail 'A5' ('blocked host used as a requestable URL at ' + ($urlHits -join ', '))
} else {
  Pass 'A5' 'blocked host is not used as a requestable URL (comment lines ignored, fixture files exempt)'
}
if ($litHits.Count -gt 0) {
  Warn 'A5b' ('blocked host appears as a bare literal on non-comment lines: ' + ($litHits -join ', ') + ' - allowed only when assembled at runtime')
} else {
  Pass 'A5b' 'no bare blocked-host literal on non-comment, non-fixture lines'
}

# ---------------------------------------------------------------- A6 slots and entry ids
$entry = $unitTexts['70-entry.js']
$core00 = $unitTexts['00-core.js']
$entryCode = ''
$core00Code = ''
if ($null -ne $entry) { $entryCode = Get-CodeText $entry }
if ($null -ne $core00) { $core00Code = Get-CodeText $core00 }
if ($null -eq $entry -or $null -eq $core00) { Fail 'A6' '70-entry.js or 00-core.js missing' }
else {
  $need = @('conversation.input.left','conversation.input.overlay','prompt-market-import-button','prompt-market-panel')
  $gone = @(); foreach ($n in $need) { if ($core00Code -notlike ('*' + $n + '*')) { $gone += $n } }
  if ($gone.Count -gt 0) { Fail 'A6' ('slot/id literals missing from 00-core.js code: ' + ($gone -join ', ')) }
  else { Pass 'A6' 'the four slot/id literals are defined in 00-core.js code (comments excluded)' }
  $need2 = @('ns.SLOT_BUTTON','ns.SLOT_PANEL','ns.ENTRY_BUTTON','ns.ENTRY_PANEL')
  $gone2 = @(); foreach ($n in $need2) { if ($entryCode -notlike ('*' + $n + '*')) { $gone2 += $n } }
  if ($gone2.Count -gt 0) { Fail 'A6b' ('70-entry.js does not use: ' + ($gone2 -join ', ')) }
  else { Pass 'A6b' '70-entry.js registers both entries through the slot/id constants (comments excluded)' }
}

# ---------------------------------------------------------------- A7 write channel: order, no write-draft dependency, no append helper
$wr = $unitTexts['30-write.js']
$wrCode = ''
if ($null -eq $wr) { Fail 'A7' '30-write.js missing' }
else {
  $wrCode = Get-CodeText $wr
  # scoped to the panel insert helper body: it must call insertText( and must never call setDraft(
  $i0 = $wr.IndexOf('W.insert = function')
  $i1 = $wr.IndexOf('W.finalizeInsert = function')
  if ($i0 -lt 0 -or $i1 -le $i0) {
    Fail 'A7' 'cannot locate the insert helper body (W.insert ... W.finalizeInsert)'
  } else {
    $insertBody = Get-CodeText ($wr.Substring($i0, $i1 - $i0))
    if ($insertBody -notmatch 'insertText\s*\(') { Fail 'A7' 'the insert helper never calls insertText(' }
    elseif ($insertBody -match 'setDraft\s*\(') { Fail 'A7' 'the insert helper calls setDraft( (main channel regression)' }
    else { Pass 'A7' 'insert helper calls insertText( and never setDraft( (scoped to its body, comments excluded)' }
  }
  # any setDraft call before the diagnostic-only fallback helper is a regression
  $iFb = $wr.IndexOf('W.fallbackSetDraft = function')
  if ($iFb -gt 0) {
    $before = Get-CodeText ($wr.Substring(0, $iFb))
    if ($before -match 'setDraft\s*\(') { Fail 'A7f' 'a setDraft(...) call appears before the diagnostic-only fallback helper' }
    else { Pass 'A7f' 'no setDraft(...) call before the diagnostic-only fallback helper (comments excluded)' }
  }

  if ($uiCode -match 'writeAndVerify') { Fail 'A7b' 'writeAndVerify is referenced in UI units (must not route the product path through the t2 diagnostic module)' }
  else { Pass 'A7b' 'no writeAndVerify reference in UI units' }
  if ($uiCode -match 'write-draft') { Fail 'A7c' 'write-draft is referenced in UI units' }
  else { Pass 'A7c' 'no write-draft reference in UI units' }
  if ($uiCode -match 'appendSeparated\s*\(') { Fail 'A7d' 'appendSeparated(...) call found (whole-draft payload hazard)' }
  else { Pass 'A7d' 'no appendSeparated(...) call' }

  $appendWord = [string]([char]0x8FFD) + [string]([char]0x52A0)
  if ($uiCode.Contains($appendWord)) { Fail 'A7e' 'an append-style UI entry exists (forbidden by the F-9 ruling; must be deleted, not disabled)' }
  else { Pass 'A7e' 'no append-style UI entry anywhere in UI units' }
}

# ---------------------------------------------------------------- A8 PM-NO-WRITE region must contain no write call
if ($null -eq $wr) { Fail 'A8' '30-write.js missing' }
else {
  $b = $wr.IndexOf('PM-NO-WRITE:BEGIN'); $e = $wr.IndexOf('PM-NO-WRITE:END')
  if ($b -lt 0 -or $e -lt 0 -or $e -le $b) { Fail 'A8' 'PM-NO-WRITE region markers not found' }
  else {
    $region = $wr.Substring($b, $e - $b)
    if ($region -match 'insertText\s*\(' -or $region -match 'setDraft\s*\(') {
      Fail 'A8' 'the refusal region contains a write call (refusal must not write anything, not even setDraft)'
    } else {
      Pass 'A8' 'refusal region contains no write call'
    }
  }
}

# ---------------------------------------------------------------- A9 fingerprint fields
$fp = @('beforeLength','afterLength','beforeHash','afterHash','replaced','verified','insertTextReturned')
$fpGone = @(); foreach ($n in $fp) { if ($wrCode -notlike ('*' + $n + '*')) { $fpGone += $n } }
if ($fpGone.Count -gt 0) { Fail 'A9' ('draft fingerprint fields missing: ' + ($fpGone -join ', ')) }
else { Pass 'A9' 'draft fingerprint fields present in code (length + hash + replaced + verified + insertTextReturned)' }

# ---------------------------------------------------------------- A10 write modes driven by the data layer
if ($uiCode -notmatch 'writeModes') { Fail 'A10' 'writeModes is not used (write policy must be driven by the data layer)' }
else { Pass 'A10' 'writeModes is read from the data layer in code (no hard-coded domain)' }
$litA = "['insert', 'append']"; $litB = '["insert", "append"]'
if ($uiCode.Contains($litA) -or $uiCode.Contains($litB)) { Fail 'A10b' 'hard-coded write-mode array literal found' }
else { Pass 'A10b' 'no hard-coded write-mode array literal in UI code' }

# ---------------------------------------------------------------- A11 probe contracts
$pr = $unitTexts['40-probe.js']
if ($null -eq $pr) { Fail 'A11' '40-probe.js missing' }
else {
  $prCode = Get-CodeText $pr
  $need = @('setDraftAlone','conclusion','readback-unreliable','spanProbe','fields','refused','draftLength')
  $gone = @(); foreach ($n in $need) { if ($prCode -notlike ('*' + $n + '*')) { $gone += $n } }
  if ($gone.Count -gt 0) { Fail 'A11' ('probe report lacks: ' + ($gone -join ', ')) }
  else { Pass 'A11' 'probe report carries the three-valued conclusion and spanProbe.fields (comments excluded)' }
}
# $core00 / $core00Code are defined ONCE, in the A6 block above (a single definition removes the
# undefined-variable typo - "$core00Code was never assigned" - that made this check fail always).
if ($core00Code -match '__pmCoreBrowserError') { Pass 'A11b' 'data-layer-not-ready error is read from __pmCoreBrowserError (code, comments excluded)' }
else { Fail 'A11b' '__pmCoreBrowserError is not read in code (must not invent a reason)' }

# ---------------------------------------------------------------- A12 error boundary and error copy
$comp = $unitTexts['60-components.js']
if ($null -eq $comp) { Fail 'A12' '60-components.js missing' }
else {
  $compCode = Get-CodeText $comp
  if ($compCode -match 'componentDidCatch') { Pass 'A12' 'an error boundary (componentDidCatch) wraps both slot entries (comments excluded)' }
  else { Fail 'A12' 'no componentDidCatch error boundary found' }
  $codes = @('E_NETWORK','E_TIMEOUT','E_HTTP','E_RATE_LIMIT','E_PARSE','E_SCHEMA','E_STORAGE','E_QUOTA','E_BAD_INPUT','E_NOT_FOUND','E_UNSUPPORTED')
  $hit = 0; foreach ($c in $codes) { if ($uiCode -like ('*' + $c + '*')) { $hit++ } }
  if ($hit -ge 4) { Pass 'A12b' ('error-code copy mapping present (' + $hit + ' codes referenced)') }
  else { Warn 'A12b' ('only ' + $hit + ' error codes referenced; error states may not cover the data-layer code set') }
}

# ---------------------------------------------------------------- A13 assembly status of plugin/client.js (INFO unless assembly started)
$client = Read-Text $clientFile
if ($null -eq $client) {
  Info 'A13' 'plugin/client.js not found - assembly not started (expected: t4 scope is plugin/ui/, assembly belongs to the integration task)'
} else {
  $cb = $client.IndexOf('PM-CORE-INLINE:BEGIN'); $ce = $client.IndexOf('PM-CORE-INLINE:END')
  $ub = $client.IndexOf('PM-UI-INLINE:BEGIN');   $ue = $client.IndexOf('PM-UI-INLINE:END')
  if ($cb -lt 0 -or $ce -le $cb) {
    Info 'A13' 'client.js has no PM-CORE-INLINE region - assembly not started'
  } elseif ($null -eq $browser) {
    Warn 'A13' 'client.js has a core region but browser.js is unavailable for comparison'
  } else {
    # Comparison unit = the whole inlined segment INCLUDING the /* BEGIN|END inlined file: X */ markers,
    # i.e. exactly what the authoritative tool plugin/core/build-client-bundle.js --check compares.
    # (The previous regex expected the unit name to be followed directly by a newline, but the real
    #  marker line is `/* BEGIN inlined file: constants.js */` - it could never match, so A13 always
    #  reported "cannot extract unit body" instead of comparing content.)
    $bRx = [regex]'/\*\s*BEGIN inlined file:'
    $eRx = [regex]'/\*\s*END inlined file:'
    $coreRegion = $client.Substring($cb, $ce - $cb)
    $bm = $bRx.Match($browser); $em = $eRx.Matches($browser)
    $cm = $bRx.Match($coreRegion); $cme = $eRx.Matches($coreRegion)
    if (-not $bm.Success -or $em.Count -eq 0) {
      Warn 'A13' 'browser.js has no /* BEGIN|END inlined file: */ markers'
    } elseif (-not $cm.Success -or $cme.Count -eq 0) {
      Fail 'A13' 'client.js core region has no /* BEGIN|END inlined file: */ markers (markers must be included, 9 pairs)'
    } else {
      $namesIn = @()
      foreach ($m in [regex]::Matches($coreRegion, 'BEGIN inlined file:\s*([^\s*/]+)')) { $namesIn += $m.Groups[1].Value }
      $missingUnits = @()
      foreach ($n in $expectedUnits) { if ($namesIn -notcontains $n) { $missingUnits += $n } }
      if ($missingUnits.Count -gt 0) {
        Fail 'A13b' ('client.js core region is missing unit(s): ' + ($missingUnits -join ', ') + ' - t3/assembly incomplete')
      } else {
        Pass 'A13b' ('all ' + $expectedUnits.Count + ' unit BEGIN markers present in the client core region')
      }
      $segB = $browser.Substring($bm.Index, ($browser.IndexOf('*/', $em[$em.Count - 1].Index) + 2) - $bm.Index)
      $segC = $coreRegion.Substring($cm.Index, ($coreRegion.IndexOf('*/', $cme[$cme.Count - 1].Index) + 2) - $cm.Index)
      $expected = Normalize-Lines $segB
      $got = Normalize-Lines $segC
      $n = [Math]::Min($expected.Count, $got.Count)
      $firstDiff = -1
      for ($i = 0; $i -lt $n; $i++) { if ($expected[$i] -ne $got[$i]) { $firstDiff = $i; break } }
      if ($firstDiff -lt 0 -and $expected.Count -eq $got.Count) {
        Pass 'A13' ('client.js core segment matches browser.js line by line, markers included (' + $expected.Count + ' lines)')
      } else {
        if ($firstDiff -lt 0) { $firstDiff = $n }
        Fail 'A13' ('client.js core segment differs from browser.js (first differing normalized line ' + ($firstDiff + 1) + '; expected ' + $expected.Count + ' lines, found ' + $got.Count + ')')
      }
    }
  }
  if ($ub -ge 0 -and $ue -gt $ub) {
    $expectedUi = New-Object System.Collections.ArrayList
    foreach ($u in $unitNames) { foreach ($ln in (Normalize-Lines $unitTexts[$u])) { [void]$expectedUi.Add($ln) } }
    $gotUi = Normalize-Lines ($client.Substring($ub, $ue - $ub))
    $n2 = [Math]::Min($expectedUi.Count, $gotUi.Count)
    $diff2 = -1
    for ($i = 0; $i -lt $n2; $i++) { if ($expectedUi[$i] -ne $gotUi[$i]) { $diff2 = $i; break } }
    if ($diff2 -lt 0 -and $expectedUi.Count -eq $gotUi.Count) { Pass 'A14' 'client.js PM-UI-INLINE region matches the plugin/ui units' }
    else {
      if ($diff2 -lt 0) { $diff2 = $n2 }
      Warn 'A14' ('client.js UI region differs from plugin/ui units (first differing normalized line ' + ($diff2 + 1) + ')')
    }
  } else {
    Info 'A14' 'client.js has no PM-UI-INLINE region - UI assembly not started'
  }
}

# ---------------------------------------------------------------- report
$failCount = 0; $warnCount = 0
foreach ($r in $results) { if ($r.level -eq 'FAIL') { $failCount++ }; if ($r.level -eq 'WARN') { $warnCount++ } }

if ($Json) {
  $payload = [pscustomobject]@{
    script = 'plugin/ui/check-ui.ps1'
    staticChecked = $true
    runtimeUntested = $true
    failCount = $failCount
    warnCount = $warnCount
    results = $results
  }
  $payload | ConvertTo-Json -Depth 5
} else {
  Write-Output '=== prompt-market UI static self-check (t4 / uismith) ==='
  Write-Output ('script dir : ' + $uiDir)
  Write-Output ''
  foreach ($r in $results) { Write-Output (('[{0}] {1} - {2}') -f $r.level, $r.id, $r.message) }
  Write-Output ''
  Write-Output '--- STATIC CHECKED (this run) ---'
  Write-Output ('  FAIL-level failures : ' + $failCount)
  Write-Output ('  warnings           : ' + $warnCount)
  Write-Output '--- RUNTIME NOT TESTED (belongs to the user acceptance gate) ---'
  Write-Output '  * button actually visible in conversation.input.left'
  Write-Output '  * panel opens/closes through conversation.input.overlay'
  Write-Output '  * draft really receives the text; Ctrl+Z really undoes it'
  Write-Output '  * favourites/custom prompts survive a restart (localStorage)'
  Write-Output '  * offline / rate-limited degrade shows an error state instead of a blank'
  Write-Output '  * the controlled probe verdict (written / not-written / readback-unreliable)'
  Write-Output ''
  if ($failCount -eq 0) { Write-Output 'RESULT: PASS (static only)'; } else { Write-Output 'RESULT: FAIL (static)'; }
}

if ($failCount -eq 0) { exit 0 } else { exit 1 }
