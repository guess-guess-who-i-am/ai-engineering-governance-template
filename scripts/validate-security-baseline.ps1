[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
& (Join-Path $Root 'scripts/scan-secrets.ps1') -Root $Root
& (Join-Path $Root 'scripts/validate-workflows.ps1') -Root $Root
Write-Output 'Security baseline passed.'
