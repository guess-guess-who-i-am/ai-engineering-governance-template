[CmdletBinding()]
param([switch]$SkipSourceSyncCheck)
$ErrorActionPreference = 'Stop'
if (-not $SkipSourceSyncCheck) {
  & node (Join-Path $PSScriptRoot 'install-codex-profile-windows.mjs') --check --json
  if ($LASTEXITCODE -ne 0) { throw 'Installed Windows profile differs from its source.' }
}
& node (Join-Path $PSScriptRoot 'test-windows-profile.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Windows install contract failed.' }
& node (Join-Path $PSScriptRoot 'test-parallel-run.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Parallel execution contract failed.' }
