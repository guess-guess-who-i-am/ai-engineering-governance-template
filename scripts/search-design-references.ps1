[CmdletBinding()]
param(
    [string]$Query,
    [string]$ProductType,
    [int]$Limit = 10,
    [string]$CatalogPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'design/catalog.json')
)

$ErrorActionPreference = 'Stop'
if ($Limit -lt 1 -or $Limit -gt 100) { throw 'Limit must be between 1 and 100.' }
& (Join-Path $PSScriptRoot 'validate-design-catalog.ps1') -Path $CatalogPath | Out-Null
$catalog = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json -Depth 20
$categories = @($catalog.entries.category | Sort-Object -Unique)
if (-not [string]::IsNullOrWhiteSpace($ProductType) -and $ProductType -notin $categories) {
    throw "Unknown product type '$ProductType'. Available: $($categories -join ', ')"
}
$needle = if ($null -eq $Query) { '' } else { $Query.Trim().ToLowerInvariant() }
$matches = foreach ($entry in $catalog.entries) {
    if ($ProductType -and $entry.category -ne $ProductType) { continue }
    $haystack = "$($entry.id) $($entry.title) $($entry.category) $($entry.description) $(@($entry.tags) -join ' ')".ToLowerInvariant()
    if ($needle -and -not $haystack.Contains($needle)) { continue }
    $score = 0
    if ($needle) {
        if ($entry.id -eq $needle) { $score += 100 }
        if ($entry.title.ToLowerInvariant() -eq $needle) { $score += 80 }
        if ($entry.id.Contains($needle)) { $score += 30 }
        if ($entry.title.ToLowerInvariant().Contains($needle)) { $score += 20 }
        if ($entry.description.ToLowerInvariant().Contains($needle)) { $score += 10 }
    }
    [pscustomobject]@{ id = $entry.id; title = $entry.title; product_type = $entry.category; score = $score; source_url = $entry.source_url; description = $entry.description }
}
@($matches | Sort-Object @{ Expression = 'score'; Descending = $true }, id | Select-Object -First $Limit)
