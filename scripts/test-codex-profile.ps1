[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot "sync-codex-profile.ps1"
$installScript = Join-Path $PSScriptRoot "install-codex-profile.ps1"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Check
if ($LASTEXITCODE -ne 0) { throw "The committed profile differs from the installed source profile." }

$missingHome = Join-Path $env:TEMP ("codex-profile-missing-" + [guid]::NewGuid().ToString("N"))
$previousErrorPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -UserHome $missingHome -Check *> $null
  $missingExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorPreference
}
if ($missingExitCode -eq 0) { throw "The sync check accepted a missing source profile." }

$testRoot = Join-Path $env:TEMP ("codex-profile-install-" + [guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path (Join-Path $testRoot ".codex") -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $testRoot ".codex\AGENTS.md"),
    "old-profile-marker",
    [Text.UTF8Encoding]::new($false)
  )

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript -UserHome $testRoot -SkipDesktopShortcuts
  if ($LASTEXITCODE -ne 0) { throw "The portable profile installer failed." }

  $hooksPath = Join-Path $testRoot ".codex\hooks.json"
  $hooks = Get-Content -Raw -LiteralPath $hooksPath | ConvertFrom-Json
  $routerCommand = [string]$hooks.hooks.UserPromptSubmit[0].hooks[0].command
  if ($routerCommand -notlike "*$testRoot*") { throw "hooks.json does not use the target user profile path." }

  $backup = Get-ChildItem -LiteralPath (Join-Path $testRoot ".codex\backups\portable-profile") -Filter "AGENTS.md" -Recurse -File | Select-Object -First 1
  if (-not $backup -or (Get-Content -Raw -LiteralPath $backup.FullName) -ne "old-profile-marker") {
    throw "The installer did not preserve the previous managed file."
  }

  $skillCount = (Get-ChildItem -LiteralPath (Join-Path $testRoot ".agents\skills") -Filter "SKILL.md" -Recurse -File).Count
  if ($skillCount -ne 6) { throw "Expected 6 custom Skills, found $skillCount." }

  $registryText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\skills-index.json")
  if ($registryText -notmatch '"name"\s*:\s*"method-github-delivery"') {
    throw "The installed Skill registry is missing method-github-delivery."
  }
  $routingText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\routing-rules.json")
  if ($routingText -notmatch '"method-github-delivery"\s*:\s*\[[^\]]*"GitHub"') {
    throw "The installed routing aliases are missing the GitHub trigger."
  }

  Write-Host "PASS: profile sync, missing-source rejection, clean install, backup, generated paths, 6 Skills, and routing inputs."
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporaryRoot = [IO.Path]::GetFullPath($env:TEMP)
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean a test directory outside TEMP: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
