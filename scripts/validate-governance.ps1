[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$required = @(
    'README.md',
    'AGENTS.md',
    'CONTEXT.md',
    'DESIGN.md',
    'TESTING.md',
    'WORKFLOW.md',
    'UPSTREAMS.md',
    'DESIGN-SOURCES.md',
    'VERSION',
    'CHANGELOG.md',
    'upstreams.lock.json',
    'docs/RELEASING.md',
    'docs/AGENT_PLATFORM_BOUNDARY.md',
    '.agents/skills/README.md',
    'design/catalog.json',
    'site/index.html',
    'quality/gates.json',
    'quality/findings.schema.json',
    'quality/findings.json',
    'quality/FINDINGS.md',
    'requirements/user-stories/TEMPLATE.md',
    '.github/workflows/governance.yml'
)

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Root $_)) })
if ($missing.Count -gt 0) {
    throw "Missing governance files: $($missing -join ', ')"
}

$agents = Get-Content -LiteralPath (Join-Path $Root 'AGENTS.md') -Raw
foreach ($authority in @('CONTEXT.md', 'DESIGN.md', '.agents/skills')) {
    if ($agents -notmatch [regex]::Escape($authority)) {
        throw "AGENTS.md does not route to $authority"
    }
}

$ignoreProbe = 'upstreams/__governance_probe__.txt'
git -C $Root check-ignore --quiet --no-index -- $ignoreProbe
if ($LASTEXITCODE -ne 0) {
    throw 'upstreams/ must remain excluded from the template repository.'
}

Write-Output 'Governance validation passed.'
