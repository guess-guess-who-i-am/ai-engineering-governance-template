[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))))
)

$ErrorActionPreference = 'Stop'
$scripts = @(
    (Join-Path $Root 'scripts/validate-governance.ps1'),
    (Join-Path $Root 'scripts/validate-skills.ps1')
)

foreach ($script in $scripts) {
    if (-not (Test-Path -LiteralPath $script)) { throw "Missing verifier: $script" }
    & $script -Root $Root
}

Write-Output 'Repository verification passed.'
