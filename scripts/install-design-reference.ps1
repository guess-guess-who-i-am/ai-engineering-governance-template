[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Id,
    [string]$TargetRoot = (Get-Location).Path,
    [string]$CatalogPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'design/catalog.json'),
    [string]$UpstreamPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'upstreams/awesome-design-md'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'validate-design-catalog.ps1') -Path $CatalogPath | Out-Null
$catalog = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json -Depth 20
$entry = @($catalog.entries | Where-Object id -eq $Id)
if ($entry.Count -ne 1) { throw "Unknown design reference '$Id'. Search the catalog first." }
$entry = $entry[0]
$actualCommit = (& git -C $UpstreamPath rev-parse HEAD 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $entry.source_commit) {
    throw "Local design mirror is not at catalog commit $($entry.source_commit)."
}
$resolvedUpstream = [IO.Path]::GetFullPath($UpstreamPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
$source = [IO.Path]::GetFullPath((Join-Path $resolvedUpstream $entry.source_path))
$sourcePrefix = $resolvedUpstream + [IO.Path]::DirectorySeparatorChar
if (-not $source.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'Catalog source_path escapes the pinned upstream or does not exist.'
}
$destination = Join-Path ([IO.Path]::GetFullPath($TargetRoot)) "design-references/$Id"
if ((Test-Path -LiteralPath $destination) -and -not $Force) { throw "Design reference already exists: $destination. Use -Force to replace it." }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $destination 'DESIGN.md') -Force
$provenance = [ordered]@{
    schema = 'design-reference-provenance/v1'
    id = $entry.id
    source_repository = $catalog.source.repository
    source_url = $entry.source_url
    source_path = $entry.source_path
    source_commit = $entry.source_commit
    source_license = $entry.license
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
    sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    modifications = @()
    notice = 'Visual identity, trademarks, proprietary fonts, and media remain owned by their respective owners; use documented substitutes and review before shipping.'
}
$provenance | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $destination 'provenance.json') -Encoding utf8
Write-Output "Installed '$Id' at $destination with pinned provenance."
