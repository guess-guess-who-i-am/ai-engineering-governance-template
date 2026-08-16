[CmdletBinding()]
param(
    [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) '.reports/findings.json'),
    [string]$Repository,
    [string[]]$Priority = @('P0', 'P1', 'P2'),
    [string]$OutputPath,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'validate-findings.ps1') -Path $Path | Out-Null
$document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 20
$eligible = @($document.findings | Where-Object { $_.priority -in $Priority -and $_.status -in @('open', 'in_progress', 'reopened') })

if (-not $Apply) {
    foreach ($finding in $eligible) { Write-Output "DRY-RUN $($finding.id) [$($finding.priority)] $($finding.title)" }
    Write-Output "Dry run: $($eligible.Count) findings are eligible for GitHub Issue sync."
    return
}

if ([string]::IsNullOrWhiteSpace($Repository)) {
    $Repository = (& gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Repository)) { throw 'Could not resolve the GitHub repository. Pass -Repository owner/name.' }
}
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Invalid GitHub repository '$Repository'." }
& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI authentication is required for -Apply.' }

function Invoke-GhChecked {
    param([string[]]$Arguments)
    $output = & gh @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "gh $($Arguments[0]) failed: $output" }
    return $output.Trim()
}

foreach ($label in @(
    @{ name = 'finding'; color = '5319E7'; description = 'Tracked quality finding' },
    @{ name = 'priority:P0'; color = 'B60205'; description = 'Immediate merge and release blocker' },
    @{ name = 'priority:P1'; color = 'D93F0B'; description = 'Major regression or release blocker' },
    @{ name = 'priority:P2'; color = 'FBCA04'; description = 'Scheduled near-term remediation' },
    @{ name = 'priority:P3'; color = '0E8A16'; description = 'Experience or maintainability improvement' }
)) {
    Invoke-GhChecked @('label', 'create', $label.name, '--repo', $Repository, '--color', $label.color, '--description', $label.description, '--force') | Out-Null
}

foreach ($finding in $eligible) {
    $marker = "Finding ID: $($finding.id)"
    $matches = Invoke-GhChecked @('issue', 'list', '--repo', $Repository, '--state', 'all', '--search', "$($finding.id) in:body", '--json', 'number,url,state', '--limit', '10') | ConvertFrom-Json
    $existing = @($matches)[0]
    $criteria = if ($finding.acceptance_criteria) { @($finding.acceptance_criteria) -join ', ' } else { 'N/A' }
    $story = if ($finding.user_story) { $finding.user_story } else { 'N/A' }
    $body = @"
$marker
Fingerprint: $($finding.fingerprint)

## Evidence

$($finding.evidence)

## Remediation

$($finding.remediation)

## Traceability

- Priority: $($finding.priority)
- Category / gate: $($finding.category) / $($finding.gate_id)
- User story / acceptance criteria: $story / $criteria
- Owner: $($finding.owner)
- First / last seen: $($finding.first_seen) / $($finding.last_seen)
- Lifecycle status: $($finding.status)
"@
    $title = "[$($finding.priority)][$($finding.gate_id)] $($finding.title)"
    if ($null -ne $existing) {
        Invoke-GhChecked @('issue', 'edit', [string]$existing.number, '--repo', $Repository, '--title', $title, '--body', $body, '--add-label', 'finding', '--add-label', "priority:$($finding.priority)") | Out-Null
        if ($existing.state -eq 'CLOSED') { Invoke-GhChecked @('issue', 'reopen', [string]$existing.number, '--repo', $Repository) | Out-Null }
        $finding.issue_url = $existing.url
    }
    else {
        $url = Invoke-GhChecked @('issue', 'create', '--repo', $Repository, '--title', $title, '--body', $body, '--label', 'finding', '--label', "priority:$($finding.priority)")
        $finding | Add-Member -NotePropertyName issue_url -NotePropertyValue $url -Force
    }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $root '.reports/findings-synced.json' }
$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$document.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8
& (Join-Path $PSScriptRoot 'validate-findings.ps1') -Path $OutputPath | Out-Null
Write-Output "Synchronized $($eligible.Count) findings to $Repository."
