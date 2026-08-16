[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $Root '.reports/site-dist' }
$source = Join-Path $Root 'site'
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Site source is missing.' }
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Recurse -Force }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'index.html'), (Join-Path $source 'styles.css'), (Join-Path $source 'app.js') -Destination $resolvedOutput
Copy-Item -LiteralPath (Join-Path $Root 'design/catalog.json') -Destination (Join-Path $resolvedOutput 'catalog.json')
New-Item -ItemType File -Path (Join-Path $resolvedOutput '.nojekyll') -Force | Out-Null
Write-Output "Built documentation site at $resolvedOutput."
