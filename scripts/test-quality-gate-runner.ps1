[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("quality-runner-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'scripts'), (Join-Path $fixtureRoot 'quality') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root 'scripts/invoke-quality-gates.ps1'), (Join-Path $Root 'scripts/validate-quality-gates.ps1') -Destination (Join-Path $fixtureRoot 'scripts')
    $config = Get-Content -LiteralPath (Join-Path $Root 'quality/gates.json') -Raw | ConvertFrom-Json -Depth 30
    foreach ($gate in $config.gates) {
        $gate.state = 'not-applicable'
        $gate | Add-Member -NotePropertyName rationale -NotePropertyValue 'Fixture keeps an explicit category decision.' -Force
        foreach ($property in @('profiles', 'workingDirectory', 'command', 'failurePriority', 'owner', 'remediation', 'requiredBeforeRelease', 'userStory', 'acceptanceCriteria')) { $gate.PSObject.Properties.Remove($property) }
    }
    $config.gates += @(
        [pscustomobject]@{
            id = 'fixture-failure'; category = 'governance'; state = 'active'; failurePriority = 'P1'; owner = 'fixture'; remediation = 'repair fixture'
            profiles = @('pr'); workingDirectory = '.'; command = [pscustomobject]@{ executable = 'pwsh'; arguments = @('-NoProfile', '-Command', "Write-Error 'expected failure'; exit 1") }
        },
        [pscustomobject]@{
            id = 'fixture-success'; category = 'functional'; state = 'active'; failurePriority = 'P2'; owner = 'fixture'; remediation = 'none'
            profiles = @('pr'); workingDirectory = '.'; command = [pscustomobject]@{ executable = 'pwsh'; arguments = @('-NoProfile', '-Command', "Write-Output 'second gate ran'; exit 0") }
        }
    )
    $config | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'quality/gates.json') -Encoding utf8
    try {
        & (Join-Path $fixtureRoot 'scripts/invoke-quality-gates.ps1') -Root $fixtureRoot -Profile pr 2>&1 | Out-Null
        throw 'Expected fixture profile to fail.'
    }
    catch { if (($_ | Out-String) -notmatch "failed 1 of 2") { throw } }
    $report = Get-Content -LiteralPath (Join-Path $fixtureRoot '.reports/quality/pr.json') -Raw | ConvertFrom-Json -Depth 20
    if (@($report.results).Count -ne 2 -or @($report.results | Where-Object status -eq 'failed').Count -ne 1 -or @($report.results | Where-Object id -eq 'fixture-success').status -ne 'passed') {
        throw 'Quality runner stopped early or did not preserve both results.'
    }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
Write-Output 'Quality runner aggregates passing and failing gates before returning failure.'
