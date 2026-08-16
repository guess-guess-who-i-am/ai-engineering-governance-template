[CmdletBinding()]
param(
    [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'design/catalog.json')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Design catalog not found: $Path" }
$catalog = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 20
if ($catalog.schema -ne 'design-reference-catalog/v1') { throw "Unsupported design catalog schema '$($catalog.schema)'." }
if ($catalog.source.commit -notmatch '^[0-9a-f]{40}$') { throw 'Design catalog source commit must be a full Git SHA.' }
if ($catalog.source.license -ne 'MIT') { throw 'Design catalog source license must be explicit.' }
$entries = @($catalog.entries)
if ($entries.Count -lt 70 -or $catalog.source.entry_count -ne $entries.Count) { throw 'Design catalog is incomplete or entry_count drifted.' }
$ids = @{}
foreach ($entry in $entries) {
    foreach ($field in @('id', 'title', 'category', 'description', 'source_url', 'source_path', 'source_commit', 'license')) {
        if ([string]::IsNullOrWhiteSpace($entry.$field)) { throw "Design entry requires '$field'." }
    }
    if ($entry.id -notmatch '^[a-z0-9]+(?:[.-][a-z0-9]+)*$') { throw "Invalid design id '$($entry.id)'." }
    if ($ids.ContainsKey($entry.id)) { throw "Duplicate design id '$($entry.id)'." }
    if ($entry.source_commit -ne $catalog.source.commit -or $entry.license -ne $catalog.source.license) { throw "$($entry.id): source provenance drifted." }
    if ($entry.source_path -ne "design-md/$($entry.id)/DESIGN.md") { throw "$($entry.id): unexpected source_path." }
    $ids[$entry.id] = $true
}
Write-Output "Validated $($entries.Count) design references from $($catalog.source.commit)."
