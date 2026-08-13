[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$Manifest = 'qualitative/manifest.json',
    [string]$ResultsDirectory = '.reports/qualitative'
)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $Root $Manifest) -Raw | ConvertFrom-Json
$criterionIds = @($config.criteria | ForEach-Object { $_.id })
$failures = [System.Collections.Generic.List[string]]::new()
$calibrationVerdicts = @{}

foreach ($case in $config.cases) {
    $resultPath = Join-Path (Join-Path $Root $ResultsDirectory) "$($case.id).json"
    if (-not (Test-Path -LiteralPath $resultPath)) {
        $failures.Add("Missing result for '$($case.id)'.")
        continue
    }

    try {
        $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    }
    catch {
        $failures.Add("Invalid JSON for '$($case.id)': $($_.Exception.Message)")
        continue
    }

    if ($result.case_id -ne $case.id) {
        $failures.Add("Result case_id '$($result.case_id)' does not match '$($case.id)'.")
    }
    if ($result.verdict -notin @('pass', 'fail')) {
        $failures.Add("'$($case.id)' has an invalid verdict.")
    }
    if ([string]::IsNullOrWhiteSpace($result.summary)) {
        $failures.Add("'$($case.id)' has no summary.")
    }

    $findings = @($result.findings)
    foreach ($criterionId in $criterionIds) {
        $matches = @($findings | Where-Object { $_.criterion -eq $criterionId })
        if ($matches.Count -ne 1) {
            $failures.Add("'$($case.id)' must contain exactly one finding for '$criterionId'.")
            continue
        }
        $finding = $matches[0]
        if ($finding.verdict -notin @('pass', 'fail') -or
            [string]::IsNullOrWhiteSpace($finding.evidence) -or
            [string]::IsNullOrWhiteSpace($finding.reason)) {
            $failures.Add("'$($case.id)' has an incomplete finding for '$criterionId'.")
        }
    }

    $unknownCriteria = @($findings | Where-Object { $_.criterion -notin $criterionIds })
    if ($unknownCriteria.Count -gt 0) {
        $failures.Add("'$($case.id)' contains unknown criteria: $($unknownCriteria.criterion -join ', ').")
    }
    $expectedOverall = if (@($findings | Where-Object { $_.verdict -eq 'fail' }).Count -gt 0) { 'fail' } else { 'pass' }
    if ($result.verdict -ne $expectedOverall) {
        $failures.Add("'$($case.id)' overall verdict must be '$expectedOverall' based on its findings.")
    }

    if ($case.role -eq 'calibration') {
        $calibrationVerdicts[$case.id] = $result.verdict
    }
    if ($result.verdict -ne $case.expected_verdict) {
        $failures.Add("'$($case.id)' expected '$($case.expected_verdict)' but evaluator returned '$($result.verdict)'.")
    }
}

$knownGood = @($config.cases | Where-Object { $_.role -eq 'calibration' -and $_.expected_verdict -eq 'pass' })
$knownBad = @($config.cases | Where-Object { $_.role -eq 'calibration' -and $_.expected_verdict -eq 'fail' })
if ($knownGood.Count -eq 0 -or $knownBad.Count -eq 0) {
    $failures.Add('Manifest must contain at least one passing and one failing calibration case.')
}

if ($failures.Count -gt 0) {
    throw "Qualitative gate failed:`n- $($failures -join "`n- ")"
}

Write-Output "Qualitative gate passed: $($config.cases.Count) cases, including $(@($config.cases | Where-Object role -eq 'calibration').Count) calibration cases."
