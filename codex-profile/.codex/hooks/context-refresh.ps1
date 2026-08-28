$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-EmptyResult {
  [Console]::Out.Write("{}")
  exit 0
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
[AUTOMATIC_TOOL_BATCHING_CONTRACT_V4]
This is mandatory on every user turn and before every later tool wave; never wait for the user to request concurrency.
- Before the first tool call, enumerate every currently knowable safe operation, mark true dependencies, and set K = min(8, the number of safe independent operations).
- If K >= 2, the first wave MUST be one outer `functions.exec` call whose JavaScript uses `Promise.all` for all K operations. Sending only one or two of several known independent operations is noncompliant; do not use a small trial batch.
- If K is 3 or 4, submit all 3 or 4. If K is 5–8, submit exactly K. If K = 1, a single call is allowed. Never invent work to reach a quota.
- Keep the same outer `functions.exec` alive for mechanically determined follow-up waves: poll live sessions, collect known follow-up files, and run predetermined checks there instead of returning to the model merely to parse an exit code or issue one obvious next call.
- Return to the model between waves only for semantic interpretation, new uncertainty, user input, approval, or a destructive decision that genuinely requires it.
- Batch every independent read, search, state check, edit, and verification command. Read a required primary Skill completely first; then immediately batch all independent evidence checks. After edits, batch all independent tests and status checks.
- Do not serialize independent operations, hide dependencies, weaken checks, or claim concurrency without overlapping execution intervals.
'@.Trim())
    $parts.Add("[CODEX_SKILL_ROUTER_GATE_V1]`nThe platform Skill list is metadata-only. Do not read Codex, user, project, task-tree, or external Skill bodies directly from that list. Read a SKILL.md only when the unified Skill Router names its exact path; if it names none, do not load a specialized Skill.")
  }
  if (Test-Path -LiteralPath $anchorPath -PathType Leaf) {
    $parts.Add("[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]`n$([IO.File]::ReadAllText($anchorPath, $utf8).Trim())")
  }
  if (Test-Path -LiteralPath $routerPath -PathType Leaf) {
    $parts.Add("[GLOBAL_METHODOLOGY_ROUTER_EN_V3]`n$([IO.File]::ReadAllText($routerPath, $utf8).Trim())")
  }

  if ($eventName -eq "SessionStart" -and [string]$hookInput.source -eq "compact") {
    $parts.Add("Compaction recovery: restore the active task, selected methodology routes, applicable `AGENTS.md` files, repository state, evidence, and first unresolved gap before continuing. Do not load the complete methodology archive; reload only the routes that still apply.")
  }
  if ($eventName -eq "UserPromptSubmit") {
    $parts.Add(@'
[TOOL_BATCH_EXECUTION_GATE_V1]
When 2 or more safe operations are known, the next tool message must be one `functions.exec` call with this shape: `const results = await Promise.all([tools.exec_command({...}), tools.exec_command({...})]); text(results.map(r => r.output).join("\n"));`
Put every known independent operation in that array (up to 8); do not send a one-command probe first. Use a later wave only when its dependency is real.
'@.Trim())
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
