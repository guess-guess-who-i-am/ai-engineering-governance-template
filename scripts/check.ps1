[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
& (Join-Path $Root 'scripts/validate-governance.ps1') -Root $Root
& (Join-Path $Root 'scripts/validate-skills.ps1') -Root $Root
Write-Output 'All repository checks passed.'

