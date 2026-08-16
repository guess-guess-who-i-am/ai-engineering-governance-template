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
