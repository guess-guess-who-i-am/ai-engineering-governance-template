[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Id,
    [Parameter(Mandatory)] [ValidateSet('open', 'in_progress', 'resolved', 'testing', 'closed', 'reopened')] [string]$Status,
    [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'quality/findings.json')
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'validate-findings.ps1') -Path $Path | Out-Null
$document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 20
$finding = @($document.findings | Where-Object id -eq $Id)
if ($finding.Count -ne 1) { throw "Expected exactly one finding with id '$Id'." }
$allowed = @{
    open = @('in_progress', 'resolved')
    in_progress = @('resolved')
    resolved = @('testing', 'closed')
    testing = @('closed', 'reopened')
    closed = @('reopened')
    reopened = @('in_progress', 'resolved')
}
$current = $finding[0].status
if ($Status -notin $allowed[$current]) { throw "Invalid finding transition: $current -> $Status" }
$finding[0].status = $Status
$finding[0].last_seen = (Get-Date).ToUniversalTime().ToString('o')
$document.updated_at = $finding[0].last_seen
$document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8
& (Join-Path $PSScriptRoot 'validate-findings.ps1') -Path $Path | Out-Null
Write-Output "${Id}: $current -> $Status"
