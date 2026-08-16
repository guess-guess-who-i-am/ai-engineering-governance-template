[CmdletBinding()]
param([string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'upstreams.lock.json'))

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Upstream lock not found: $Path" }
$lock = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 10
if ($lock.schema -ne 'upstream-lock/v1') { throw "Unsupported upstream lock schema '$($lock.schema)'." }
$names = @{}
foreach ($source in @($lock.sources)) {
    foreach ($field in @('name', 'url', 'branch', 'commit', 'license', 'usage')) {
        if ([string]::IsNullOrWhiteSpace($source.$field)) { throw "Upstream source requires '$field'." }
    }
    if ($source.name -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "Invalid upstream name '$($source.name)'." }
    if ($source.commit -notmatch '^[0-9a-f]{40}$') { throw "$($source.name): commit must be a full Git SHA." }
    if ($source.url -notmatch '^(https://github\.com/|[A-Za-z]:[\\/]|/)') { throw "$($source.name): unsupported source URL or local test path." }
    if ($names.ContainsKey($source.name)) { throw "Duplicate upstream '$($source.name)'." }
    $names[$source.name] = $true
}
if (@($lock.sources).Count -lt 5) { throw 'The upstream lock omitted a governed research source.' }
Write-Output "Validated $(@($lock.sources).Count) pinned upstream sources."
