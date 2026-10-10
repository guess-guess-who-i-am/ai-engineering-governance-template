[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$KestPath = $env:KEST_BIN,
    [ValidateSet('local', 'ci')] [string]$Profile = 'ci'
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($Root)
if ([string]::IsNullOrWhiteSpace($KestPath)) {
    $candidate = Join-Path $resolvedRoot '.tools/bin/kest.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $KestPath = $candidate }
}
if ([string]::IsNullOrWhiteSpace($KestPath) -or -not (Test-Path -LiteralPath $KestPath -PathType Leaf)) {
    throw 'No Kest CLI was supplied. Set KEST_BIN to a locally installed, license-reviewed Kest executable.'
}

$flow = Join-Path $resolvedRoot '.kest/flow/governance-smoke.flow.md'
$json = Join-Path $resolvedRoot '.kest/reports/flow-results.json'
$junit = Join-Path $resolvedRoot '.kest/reports/flow-results.xml'
New-Item -ItemType Directory -Path (Split-Path -Parent $json) -Force | Out-Null

& $KestPath run $flow --profile $Profile --strict --fail-fast --quiet --output json --report-json $json --report-junit $junit
if ($LASTEXITCODE -ne 0) { throw "Kest Flow failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $json) -or -not (Test-Path -LiteralPath $junit)) { throw 'Kest did not produce JSON and JUnit reports.' }
$report = Get-Content -LiteralPath $json -Raw | ConvertFrom-Json
if ([int]$report.failed_flows -ne 0 -or [int]$report.failed_steps -ne 0 -or [int]$report.passed_steps -lt 2) {
    throw 'Kest Flow report did not prove both smoke steps passed.'
}
Write-Output "Kest Flow executed: $($report.passed_steps)/$($report.total_steps) steps passed; $($report.duration_ms) ms."
