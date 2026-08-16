[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$SitePath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($SitePath)) {
    $SitePath = Join-Path $Root '.reports/site-test'
    & (Join-Path $Root 'scripts/build-docs-site.ps1') -Root $Root -OutputPath $SitePath | Out-Null
}
$html = Get-Content -LiteralPath (Join-Path $SitePath 'index.html') -Raw
$css = Get-Content -LiteralPath (Join-Path $SitePath 'styles.css') -Raw
$js = Get-Content -LiteralPath (Join-Path $SitePath 'app.js') -Raw
foreach ($required in @('lang="zh-CN"', 'name="viewport"', 'class="skip-link"', 'id="main"', 'tabindex="-1"', 'for="catalog-search"', 'aria-live="polite"', '<nav aria-label=')) {
    if (-not $html.Contains($required, [StringComparison]::Ordinal)) { throw "Site accessibility contract is missing: $required" }
}
foreach ($required in @(':focus-visible', '@media (max-width: 560px)', '@media (prefers-reduced-motion: reduce)')) {
    if (-not $css.Contains($required, [StringComparison]::Ordinal)) { throw "Site responsive/accessibility CSS is missing: $required" }
}
if ($html -match '<script[^>]+src="https?://' -or $html -match '<link[^>]+href="https?://[^\"]+\.css') { throw 'Site may not load third-party scripts or styles.' }
if ($html -match '\sstyle="' -or $js -match '\.innerHTML\s*=') { throw 'Site forbids inline style and unsafe innerHTML rendering.' }
$budgets = @{ 'index.html' = 30000; 'styles.css' = 20000; 'app.js' = 10000; 'catalog.json' = 250000 }
$total = 0
foreach ($asset in $budgets.Keys) {
    $size = (Get-Item -LiteralPath (Join-Path $SitePath $asset)).Length
    if ($size -gt $budgets[$asset]) { throw "$asset exceeds its $($budgets[$asset])-byte budget: $size" }
    $total += $size
}
if ($total -gt 300000) { throw "Documentation site exceeds its 300000-byte total budget: $total" }
& (Join-Path $Root 'scripts/validate-design-catalog.ps1') -Path (Join-Path $SitePath 'catalog.json') | Out-Null
Write-Output "Documentation site static, responsive, accessibility, and performance budgets passed ($total bytes)."
