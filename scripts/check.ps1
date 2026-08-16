[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
& (Join-Path $Root 'scripts/invoke-quality-gates.ps1') -Profile pr -Root $Root
Write-Output 'All PR quality gates passed.'
