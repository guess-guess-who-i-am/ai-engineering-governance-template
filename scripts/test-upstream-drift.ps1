[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
& (Join-Path $Root 'scripts/validate-upstream-lock.ps1') -Path (Join-Path $Root 'upstreams.lock.json') | Out-Null
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("upstream-drift-" + [guid]::NewGuid().ToString('N'))
$remote = Join-Path $fixtureRoot 'remote'
$lockPath = Join-Path $fixtureRoot 'lock.json'
$reportPath = Join-Path $fixtureRoot 'report.json'
try {
    New-Item -ItemType Directory -Path $remote -Force | Out-Null
    & git -C $remote init -b main | Out-Null
    'first' | Set-Content -LiteralPath (Join-Path $remote 'state.txt') -Encoding utf8
    & git -C $remote add state.txt
    & git -C $remote -c user.name=fixture -c user.email=fixture@example.invalid commit -m first | Out-Null
    $first = (& git -C $remote rev-parse HEAD).Trim()
    [pscustomobject]@{
        schema = 'upstream-lock/v1'
        sources = @(1..5 | ForEach-Object { [pscustomobject]@{ name = "fixture-$_"; url = $remote; branch = 'main'; commit = $first; license = 'MIT'; usage = 'test' } })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $lockPath -Encoding utf8
    & (Join-Path $Root 'scripts/check-upstream-drift.ps1') -Root $Root -LockPath $lockPath -OutputPath $reportPath -FailOnDrift | Out-Null
    'second' | Set-Content -LiteralPath (Join-Path $remote 'state.txt') -Encoding utf8
    & git -C $remote add state.txt
    & git -C $remote -c user.name=fixture -c user.email=fixture@example.invalid commit -m second | Out-Null
    try {
        & (Join-Path $Root 'scripts/check-upstream-drift.ps1') -Root $Root -LockPath $lockPath -OutputPath $reportPath -FailOnDrift 2>&1 | Out-Null
        throw 'Expected drift to fail.'
    }
    catch { if (($_ | Out-String) -notmatch 'Upstream attention required') { throw } }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($report.status -ne 'attention-required' -or @($report.sources | Where-Object status -eq 'drifted').Count -ne 5) { throw 'Drift report did not preserve all changed sources.' }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
Write-Output 'Upstream current and drifted cases passed.'
