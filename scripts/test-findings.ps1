[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $Root 'scripts/validate-findings.ps1'
$collector = Join-Path $Root 'scripts/collect-findings.ps1'
$transitioner = Join-Path $Root 'scripts/set-finding-status.ps1'
& $validator -Path (Join-Path $Root 'quality/findings.json') | Out-Null

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("findings-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$baselinePath = Join-Path $fixtureRoot 'baseline.json'
$failedReportPath = Join-Path $fixtureRoot 'failed-report.json'
$passedReportPath = Join-Path $fixtureRoot 'passed-report.json'
$outputPath = Join-Path $fixtureRoot 'output.json'
$fingerprint = 'a' * 64

try {
    [pscustomobject]@{
        schema = 'quality-findings/v1'
        updated_at = '2026-08-15T00:00:00Z'
        findings = @([pscustomobject]@{
            id = 'F-AAAAAAAAAAAA'; fingerprint = $fingerprint; priority = 'P1'; category = 'functional'
            gate_id = 'fixture-gate'; title = 'Fixture failed'; evidence = 'old evidence'; remediation = 'repair fixture'
            owner = 'fixture-owner'; first_seen = '2026-08-14T00:00:00Z'; last_seen = '2026-08-15T00:00:00Z'; status = 'testing'
        })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $baselinePath -Encoding utf8

    [pscustomobject]@{
        schema = 'quality-gate-report/v2'; profile = 'pr'; status = 'failed'; project_kind = 'fixture'; generated_at = '2026-08-16T00:00:00Z'; blockers = @()
        results = @([pscustomobject]@{
            id = 'fixture-gate'; category = 'functional'; status = 'failed'; duration_ms = 1; error = 'new evidence'
            finding = [pscustomobject]@{
                id = 'F-AAAAAAAAAAAA'; fingerprint = $fingerprint; priority = 'P0'; category = 'functional'; gate_id = 'fixture-gate'
                title = 'Fixture failed'; evidence = 'new evidence'; remediation = 'repair now'; owner = 'fixture-owner'
            }
        })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $failedReportPath -Encoding utf8

    & $collector -Root $Root -BaselinePath $baselinePath -ReportPath $failedReportPath -OutputPath $outputPath | Out-Null
    $reopened = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json -Depth 10
    if ($reopened.findings.Count -ne 1 -or $reopened.findings[0].status -ne 'reopened' -or $reopened.findings[0].priority -ne 'P0') {
        throw 'Collector did not deduplicate and reopen the existing finding.'
    }
    $dryRun = & (Join-Path $Root 'scripts/sync-findings-to-github.ps1') -Path $outputPath 2>&1 | Out-String
    if ($dryRun -notmatch 'DRY-RUN F-AAAAAAAAAAAA' -or $dryRun -notmatch '1 findings are eligible') {
        throw 'GitHub sync dry-run did not select the reopened P0 finding.'
    }

    [pscustomobject]@{
        schema = 'quality-gate-report/v2'; profile = 'pr'; status = 'passed'; project_kind = 'fixture'; generated_at = '2026-08-16T00:01:00Z'; blockers = @()
        results = @([pscustomobject]@{ id = 'fixture-gate'; category = 'functional'; status = 'passed'; duration_ms = 1 })
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $passedReportPath -Encoding utf8
    & $collector -Root $Root -BaselinePath $outputPath -ReportPath $passedReportPath -OutputPath $outputPath | Out-Null
    $resolved = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json -Depth 10
    if ($resolved.findings[0].status -ne 'resolved') { throw 'A passing gate did not move the active finding to resolved.' }

    & $transitioner -Id 'F-AAAAAAAAAAAA' -Status testing -Path $outputPath | Out-Null
    try {
        & $transitioner -Id 'F-AAAAAAAAAAAA' -Status in_progress -Path $outputPath 2>&1 | Out-Null
        throw 'Expected an invalid lifecycle transition to fail.'
    }
    catch {
        if (($_ | Out-String) -notmatch 'Invalid finding transition') { throw }
    }

    $invalid = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json -Depth 10
    $invalid.findings[0].priority = 'critical'
    $invalid | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $baselinePath -Encoding utf8
    try {
        & $validator -Path $baselinePath 2>&1 | Out-Null
        throw 'Expected an invalid priority to fail.'
    }
    catch {
        if (($_ | Out-String) -notmatch 'priority must be P0-P3') { throw }
    }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

Write-Output 'Findings schema, deduplication, priority, and lifecycle cases passed.'
