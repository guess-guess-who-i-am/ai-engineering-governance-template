[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$validator = Join-Path $Root 'scripts/validate-kest-flow.ps1'
& $validator -Root $Root | Out-Null
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("kest-flow-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
    $flowPath = Join-Path $fixtureRoot 'flow.md'
    $configPath = Join-Path $fixtureRoot 'config.yaml'
    Copy-Item -LiteralPath (Join-Path $Root '.kest/flow/governance-smoke.flow.md') -Destination $flowPath
    Copy-Item -LiteralPath (Join-Path $Root '.kest/flow.config.yaml') -Destination $configPath
    (Get-Content -LiteralPath $flowPath -Raw).Replace('@to design_file', '@to missing_step') | Set-Content -LiteralPath $flowPath -Encoding utf8
    try {
        & $validator -Root $Root -FlowPath $flowPath -ConfigPath $configPath 2>&1 | Out-Null
        throw 'Expected an unknown Kest edge endpoint to fail.'
    }
    catch { if (($_ | Out-String) -notmatch 'unknown @to endpoint') { throw } }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
Write-Output 'Kest Flow valid and broken-edge cases passed.'
