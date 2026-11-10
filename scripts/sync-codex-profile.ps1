[CmdletBinding()]
param(
  [string]$UserHome = $env:USERPROFILE,
  [switch]$Check
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$bundleRoot = Join-Path $repositoryRoot "codex-profile"
$codexHome = Join-Path $UserHome ".codex"
$agentsHome = Join-Path $UserHome ".agents"

$codexFiles = @(
  "AGENTS.md",
  "hooks/hook-dispatch.mjs",
  "hooks/context-refresh.ps1",
  "hooks/refresh-skill-registry.ps1",
  "hooks/skill-router.mjs",
  "hooks/skill-router.ps1",
  "hooks/validate-methodology-routing.ps1",
  "prompts/global-attention-anchor.en.md",
  "prompts/global-attention-anchor.zh.md",
  "prompts/global-every-turn.en.md",
  "prompts/global-every-turn.zh.md",
  "prompts/global-methodology-map.json",
  "prompts/global-methodology-router.en.md",
  "prompts/global-methodology-router.zh.md",
  "prompts/global-methodology-routing-review.zh.md",
  "prompts/global-methodology-source.zh.md",
  "prompt-publisher/edit-global-prompt.ps1",
  "prompt-publisher/launch-global-prompt-editor.vbs",
  "prompt-publisher/methodology-state.json",
  "prompt-publisher/methodology-targets.json",
  "prompt-publisher/methodology-translation-cache.en.md",
  "prompt-publisher/publish-global-prompt.mjs",
  "prompt-publisher/publish-methodology.mjs",
  "prompt-publisher/README.zh.md",
  "prompt-publisher/test-methodology-publisher.mjs",
  "prompt-publisher/translation.schema.json",
  "skill-registry/routing-rules.json"
)

$skillNames = @(
  "manage-global-methodology",
  "method-engineering-execution",
  "method-evaluation-gates",
  "method-github-delivery",
  "method-research-evidence",
  "method-task-tree"
)

$entries = [Collections.Generic.List[object]]::new()
foreach ($relativePath in $codexFiles) {
  $entries.Add([pscustomobject]@{
    Source = Join-Path $codexHome $relativePath
    Destination = Join-Path (Join-Path $bundleRoot ".codex") $relativePath
  })
}
foreach ($skillName in $skillNames) {
  foreach ($relativePath in @("SKILL.md", "agents/openai.yaml")) {
    $entries.Add([pscustomobject]@{
      Source = Join-Path (Join-Path (Join-Path $agentsHome "skills") $skillName) $relativePath
      Destination = Join-Path (Join-Path (Join-Path (Join-Path $bundleRoot ".agents") "skills") $skillName) $relativePath
    })
  }
}

$missing = @($entries | Where-Object { -not (Test-Path -LiteralPath $_.Source -PathType Leaf) })
if ($missing.Count) {
  $missing.Source | ForEach-Object { Write-Error "Missing source file: $_" }
  exit 1
}

if ($Check) {
  $different = [Collections.Generic.List[string]]::new()
  foreach ($entry in $entries) {
    if (-not (Test-Path -LiteralPath $entry.Destination -PathType Leaf)) {
      $different.Add("missing: $($entry.Destination)")
      continue
    }
    $sourceHash = (Get-FileHash -LiteralPath $entry.Source -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $entry.Destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) { $different.Add("changed: $($entry.Destination)") }
  }
  if ($different.Count) {
    $different | ForEach-Object { Write-Error $_ }
    exit 1
  }
  Write-Host "PASS: repository Codex profile matches the installed profile ($($entries.Count) files)."
  exit 0
}

foreach ($entry in $entries) {
  $destinationDirectory = Split-Path -Parent $entry.Destination
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
}

Write-Host "Synchronized $($entries.Count) portable Codex profile files into $bundleRoot"

