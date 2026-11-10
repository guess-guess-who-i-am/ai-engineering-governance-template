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
  if ($eventName -eq "UserPromptSubmit") {
    $parts.Add(@'
[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3]
Apply this execution contract on every user turn and before every later tool wave. Do not wait for the user to request concurrency.
- Before entering tools, enumerate all currently knowable operations, separate independent work from true dependencies, and let K = min(8, the independent count).
- Use one outer `functions.exec` as the orchestration envelope for the largest safe phase. Run independent calls with `Promise.all`; when K is 5-8, the first wave must contain exactly K meaningful calls, not a 2-4 call sample.
- Keep using the same outer `functions.exec` for mechanically determined follow-up waves after awaited results. Poll live sessions, collect known follow-up files, and run predetermined verification there instead of returning to the model merely to plan, parse an exit code, or issue one obvious next call.
- Return to the model between waves only when semantic interpretation, a newly discovered uncertainty, user input, approval, or a destructive decision is genuinely required.
- When the user lists up to eight independent items, process every listed item in the first wave. Never serialize independent reads, searches, state checks, edits, or verification commands.
- Read a required primary Skill completely first, then batch all independent evidence checks immediately. After edits, batch all independent tests and status checks.
- Do not invent calls to fill a quota, hide dependencies, weaken checks, or claim concurrency without overlapping execution intervals.
- A phase with fewer than two independent operations may remain single-step. Otherwise, repeated one-call model-tool round trips are noncompliant.
'@.Trim())
  }
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
