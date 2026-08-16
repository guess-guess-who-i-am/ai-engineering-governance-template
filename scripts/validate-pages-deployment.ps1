[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
& (Join-Path $Root 'scripts/validate-workflows.ps1') -Root $Root | Out-Null
$workflow = Get-Content -LiteralPath (Join-Path $Root '.github/workflows/pages.yml') -Raw
foreach ($required in @('environment:', 'name: github-pages', 'url: ${{ steps.deployment.outputs.page_url }}', 'Invoke-WebRequest -Uri $env:PAGE_URL', "Contains('AI 工程治理模板')")) {
    if (-not $workflow.Contains($required, [StringComparison]::Ordinal)) { throw "Pages deployment lacks live smoke evidence: $required" }
}
Write-Output 'Pages deployment contract includes environment URL and post-deploy content smoke.'
