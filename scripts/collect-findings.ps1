[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$BaselinePath,
    [string[]]$ReportPath,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BaselinePath)) { $BaselinePath = Join-Path $Root 'quality/findings.json' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $Root '.reports/findings.json' }
if (-not $ReportPath) { $ReportPath = @(Get-ChildItem -LiteralPath (Join-Path $Root '.reports/quality') -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object FullName) }
& (Join-Path $Root 'scripts/validate-findings.ps1') -Path $BaselinePath | Out-Null
$baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json -Depth 20
$byFingerprint = @{}
foreach ($finding in @($baseline.findings)) { $byFingerprint[$finding.fingerprint] = $finding }
$now = (Get-Date).ToUniversalTime().ToString('o')
$observedGateIds = @{}

foreach ($path in @($ReportPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Quality report not found: $path" }
    $report = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 20
    if ($report.schema -ne 'quality-gate-report/v2') { throw "$path is not a findings-capable quality report." }
    foreach ($result in @($report.results)) {
        $observedGateIds[$result.id] = $result.status
        if ($result.status -ne 'failed') { continue }
        $incoming = $result.finding
        if ($null -eq $incoming) { throw "${path}: failed gate '$($result.id)' has no finding." }
        if ($byFingerprint.ContainsKey($incoming.fingerprint)) {
            $existing = $byFingerprint[$incoming.fingerprint]
            $existing.priority = $incoming.priority
            $existing.evidence = $incoming.evidence
            $existing.remediation = $incoming.remediation
            $existing.owner = $incoming.owner
            $existing.last_seen = $now
            if ($existing.status -in @('resolved', 'testing', 'closed')) { $existing.status = 'reopened' }
        }
        else {
            $incoming.first_seen = $now
            $incoming.last_seen = $now
            $incoming.status = 'open'
            $byFingerprint[$incoming.fingerprint] = $incoming
        }
    }
}

foreach ($finding in @($byFingerprint.Values)) {
    if ($observedGateIds.ContainsKey($finding.gate_id) -and $observedGateIds[$finding.gate_id] -eq 'passed' -and $finding.status -in @('open', 'in_progress', 'reopened')) {
        $finding.status = 'resolved'
        $finding.last_seen = $now
    }
}

$priorityOrder = @{ P0 = 0; P1 = 1; P2 = 2; P3 = 3 }
$sorted = @($byFingerprint.Values | Sort-Object @{ Expression = { $priorityOrder[$_.priority] } }, @{ Expression = 'first_seen' })
$output = [pscustomobject]@{ schema = 'quality-findings/v1'; updated_at = $now; findings = $sorted }
$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$output | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8
& (Join-Path $Root 'scripts/validate-findings.ps1') -Path $OutputPath | Out-Null
Write-Output "Collected $($sorted.Count) findings into $OutputPath."
