[CmdletBinding()]
param(
    [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'quality/findings.json')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Findings file not found: $Path" }
$document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 20
if ($document.schema -ne 'quality-findings/v1') { throw "Unsupported findings schema '$($document.schema)'." }
try { [DateTimeOffset]::Parse($document.updated_at) | Out-Null } catch { throw 'updated_at must be an ISO-8601 date-time.' }
if ($null -eq $document.findings) { throw 'findings must be an array.' }

$priorities = @('P0', 'P1', 'P2', 'P3')
$statuses = @('open', 'in_progress', 'resolved', 'testing', 'closed', 'reopened')
$ids = @{}
$fingerprints = @{}

foreach ($finding in @($document.findings)) {
    foreach ($field in @('id', 'fingerprint', 'priority', 'category', 'gate_id', 'title', 'evidence', 'remediation', 'owner', 'first_seen', 'last_seen', 'status')) {
        if ([string]::IsNullOrWhiteSpace($finding.$field)) { throw "Finding requires non-empty '$field'." }
    }
    if ($finding.id -notmatch '^F-[A-F0-9]{12}$') { throw "Invalid finding id '$($finding.id)'." }
    if ($finding.fingerprint -notmatch '^[a-f0-9]{64}$') { throw "$($finding.id): fingerprint must be 64 lowercase hexadecimal characters." }
    if ($finding.priority -notin $priorities) { throw "$($finding.id): priority must be P0-P3." }
    if ($finding.status -notin $statuses) { throw "$($finding.id): unsupported status '$($finding.status)'." }
    if ($finding.gate_id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "$($finding.id): invalid gate_id '$($finding.gate_id)'." }
    if ($ids.ContainsKey($finding.id)) { throw "Duplicate finding id '$($finding.id)'." }
    if ($fingerprints.ContainsKey($finding.fingerprint)) { throw "Duplicate finding fingerprint '$($finding.fingerprint)'." }
    $ids[$finding.id] = $true
    $fingerprints[$finding.fingerprint] = $true

    try { $firstSeen = [DateTimeOffset]::Parse($finding.first_seen) } catch { throw "$($finding.id): invalid first_seen." }
    try { $lastSeen = [DateTimeOffset]::Parse($finding.last_seen) } catch { throw "$($finding.id): invalid last_seen." }
    if ($lastSeen -lt $firstSeen) { throw "$($finding.id): last_seen precedes first_seen." }
    if ($null -ne $finding.user_story -and $finding.user_story -notmatch '^US-[0-9]{3}$') { throw "$($finding.id): invalid user_story." }
    if ($null -ne $finding.acceptance_criteria) {
        foreach ($criterion in @($finding.acceptance_criteria)) {
            if ($criterion -notmatch '^AC-[0-9]{3}$') { throw "$($finding.id): invalid acceptance criterion '$criterion'." }
        }
    }
    if ($null -ne $finding.issue_url -and $finding.issue_url -notmatch '^https://github\.com/[^/]+/[^/]+/issues/[0-9]+$') {
        throw "$($finding.id): issue_url must reference a GitHub Issue."
    }
}

Write-Output "Validated $(@($document.findings).Count) findings."
