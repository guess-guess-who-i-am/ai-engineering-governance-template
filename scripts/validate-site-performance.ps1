[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$assets = @{
    'site/index.html' = 30000
    'site/styles.css' = 20000
    'site/app.js' = 10000
    'design/catalog.json' = 250000
}
$total = 0
foreach ($relative in $assets.Keys) {
    $size = (Get-Item -LiteralPath (Join-Path $Root $relative)).Length
    if ($size -gt $assets[$relative]) { throw "$relative exceeds its $($assets[$relative])-byte budget: $size" }
    $total += $size
}
if ($total -gt 300000) { throw "Documentation site exceeds its 300000-byte total budget: $total" }
if ((Get-Content -LiteralPath (Join-Path $Root 'site/index.html') -Raw) -match '<(img|video|iframe)\b') { throw 'Documentation landing page may not add heavyweight media without a reviewed budget.' }
Write-Output "Documentation performance budget passed ($total bytes, no heavyweight embeds)."
