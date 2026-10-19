[CmdletBinding()]
param(
  [string]$UserHome = $env:USERPROFILE,
  [switch]$SkipDesktopShortcuts,
  [switch]$Check
)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'install-codex-profile-windows.mjs'),'--home',$UserHome,'--json')
if ($Check) { $arguments += '--check' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Windows profile verification failed. For a new machine use deploy-codex-profile-windows.ps1 to install dependencies first.' }
# Existing desktop Prompt editor shortcuts remain valid: their paths do not change.
