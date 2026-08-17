$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-EmptyResult {
  [Console]::Out.Write("{}")
  exit 0
}

function Find-ProjectFile {
  param(
    [Parameter(Mandatory = $true)][string]$StartDirectory,
    [Parameter(Mandatory = $true)][string]$FileName
  )
  $current = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($StartDirectory))
  while ($null -ne $current) {
    $candidate = Join-Path $current.FullName $FileName
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    $current = $current.Parent
  }
  return $null
}

function Get-HookPrompt {
  param([Parameter(Mandatory = $true)][object]$HookInput)
  foreach ($name in @("prompt", "user_prompt", "message", "text")) {
    $property = $HookInput.PSObject.Properties[$name]
    if ($property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      return [string]$property.Value
    }
  }
  return ""
}

function Test-ToolHeavyPrompt {
  param([string]$Prompt)
  if ([string]::IsNullOrWhiteSpace($Prompt)) { return $false }
  if ($Prompt -match "\u4E0D\u8981\u8C03\u7528\u5DE5\u5177|\u65E0\u9700\u5DE5\u5177|\u4E0D\u8981\u5E76\u53D1|\u505C\u6B62\u5E76\u53D1|\u5173\u95ED\u5E76\u53D1|\u53EA\u56DE\u7B54|\u53EA\u89E3\u91CA|\u9010\u6B65\u786E\u8BA4|\u6BCF\u4E00\u6B65.{0,8}\u786E\u8BA4|do not use tools|without tools|disable concurrency|stop parallel|confirm each step") {
    return $false
  }
  if ($Prompt -match "\u5E76\u53D1|\u6279\u91CF\u5DE5\u5177|\u5DE5\u5177\u8C03\u7528|\u5DE5\u5177\u5F80\u8FD4|Promise\.all|parallel(?:ize|ism| tool calls?)?|concurren(?:cy|t)") {
    return $true
  }
  return $Prompt -match "\u4FEE\u6539|\u5B9E\u73B0|\u4FEE\u590D|\u642D\u5EFA|\u914D\u7F6E|\u91CD\u6784|\u4E0A\u4F20|\u4E0B\u8F7D|\u8FD0\u884C|\u6D4B\u8BD5|\u9A8C\u8BC1|\u68C0\u67E5|\u641C\u7D22|\u8C03\u7814|\u5BA1\u8BA1|\u6279\u91CF|\u590D\u73B0|\u5B89\u88C5|\u90E8\u7F72|\u63D0\u4EA4|\u63A8\u9001|\u6784\u5EFA|\u6392\u67E5|edit|implement|fix|build|configure|refactor|upload|download|run|test|verify|inspect|search|research|audit|reproduce|install|deploy|commit|push|debug"
}

try {
  $inputText = [Console]::In.ReadToEnd()
  if (-not $inputText) { Write-EmptyResult }
  try { $hookInput = $inputText | ConvertFrom-Json } catch { Write-EmptyResult }

  $eventName = [string]$hookInput.hook_event_name
  if ($eventName -notin @("UserPromptSubmit", "SessionStart")) { Write-EmptyResult }
  if ($eventName -eq "SessionStart" -and [string]$hookInput.source -notin @("startup", "resume", "clear", "compact")) { Write-EmptyResult }

  $codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
  $anchorPath = Join-Path $codexRoot "prompts\global-attention-anchor.en.md"
  $routerPath = Join-Path $codexRoot "prompts\global-methodology-router.en.md"

  $parts = [Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $anchorPath -PathType Leaf) {
    $parts.Add("[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]`n$([IO.File]::ReadAllText($anchorPath, $utf8).Trim())")
  }
  if (Test-Path -LiteralPath $routerPath -PathType Leaf) {
    $parts.Add("[GLOBAL_METHODOLOGY_ROUTER_EN_V3]`n$([IO.File]::ReadAllText($routerPath, $utf8).Trim())")
  }

  $cwd = if ([string]$hookInput.cwd) { [string]$hookInput.cwd } else { (Get-Location).Path }
  if (Test-Path -LiteralPath $cwd -PathType Container) {
    $taskTreePath = Find-ProjectFile -StartDirectory $cwd -FileName "task-tree.md"
    $taskTreesPath = Find-ProjectFile -StartDirectory $cwd -FileName "task-trees.json"
    if ($taskTreePath -or $taskTreesPath) {
      $parts.Add("Deterministic route: task-tree state exists. Load `method-task-tree` before acting, call `task_tree_focus`, and apply the nearest project `AGENTS.md`. The latest user request overrides stale graph focus; `GraphState.NextPlan` is never executable.")
    }
  }

  if ($eventName -eq "SessionStart" -and [string]$hookInput.source -eq "compact") {
    $parts.Add("Compaction recovery: restore the active task, selected methodology routes, applicable `AGENTS.md` files, repository state, evidence, and first unresolved gap before continuing. Do not load the complete methodology archive; reload only the routes that still apply.")
  }

  if ($eventName -eq "UserPromptSubmit") {
    $prompt = Get-HookPrompt -HookInput $hookInput
    if (Test-ToolHeavyPrompt -Prompt $prompt) {
      $parts.Add(@'
[TOOL_BATCHING_EXECUTION_CONTRACT_V1]
This prompt is tool-heavy. Batching is an execution requirement.
- Before each tool phase, partition the next operations into independent and dependent groups.
- If at least two are independent, the next tool action MUST use one outer `functions.exec` with `Promise.all`. Prefer 3-8 meaningful nested calls when available; never serialize independent reads, searches, state checks, or verifications.
- Read any required primary Skill completely first; immediately afterward, batch all independent evidence and project-state checks. Do not return to the model between operations whose inputs are already known.
- Analyze each batch once, then batch the next independent phase. Keep dependent, interactive, approval-sensitive, and destructive operations sequential.
- Do not invent calls to meet a quota, chain unrelated shell commands, or weaken required checks.
'@.Trim())
    }
  }

  if ($parts.Count -eq 0) { Write-EmptyResult }
  $payload = [ordered]@{
    hookSpecificOutput = [ordered]@{
      hookEventName = $eventName
      additionalContext = ($parts -join "`n`n")
    }
  }
  [Console]::Out.Write(($payload | ConvertTo-Json -Depth 4 -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine("Context refresh hook skipped: $($_.Exception.Message)")
  Write-EmptyResult
}
