[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Query,
    [string]$ProductType,
    [ValidateRange(1, 5)] [int]$Limit = 5,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$search = Join-Path $Root 'scripts/search-design-references.ps1'
if (-not (Test-Path -LiteralPath $search -PathType Leaf)) { throw "Missing design reference search: $search" }

$searchParameters = @{
    Query = $Query
    Limit = $Limit
    CatalogPath = Join-Path $Root 'design/catalog.json'
}
if (-not [string]::IsNullOrWhiteSpace($ProductType)) { $searchParameters.ProductType = $ProductType }
$matches = @(& $search @searchParameters)
if ($matches.Count -eq 0) { throw 'Design reference search returned no candidates.' }

[pscustomobject]@{
    query = $Query
    product_type = if ($ProductType) { $ProductType } else { $null }
    candidate_count = $matches.Count
    candidates = @($matches | ForEach-Object {
        [pscustomobject]@{
            id = $_.id
            title = $_.title
            product_type = $_.product_type
            source_url = $_.source_url
            reason = ([string]$_.description).Substring(0, [Math]::Min(280, ([string]$_.description).Length))
        }
    })
    next_action = 'Choose only a materially relevant candidate, then run install-design-reference.ps1 for that ID if a local DESIGN.md is needed.'
} | ConvertTo-Json -Depth 6
