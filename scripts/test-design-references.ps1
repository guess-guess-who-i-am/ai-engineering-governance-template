[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$catalog = Join-Path $Root 'design/catalog.json'
& (Join-Path $Root 'scripts/validate-design-catalog.ps1') -Path $catalog | Out-Null
$voice = @(& (Join-Path $Root 'scripts/search-design-references.ps1') -Query voice -CatalogPath $catalog)
if ('elevenlabs' -notin $voice.id) { throw 'Design search did not find ElevenLabs for voice.' }
$ai = @(& (Join-Path $Root 'scripts/search-design-references.ps1') -ProductType ai-llm -Limit 100 -CatalogPath $catalog)
if ($ai.Count -lt 10 -or 'x.ai' -notin $ai.id) { throw 'AI/LLM product-type recommendations are incomplete.' }

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("design-install-" + [guid]::NewGuid().ToString('N'))
try {
    $fixtureUpstream = Join-Path $fixtureRoot 'upstream'
    $fixtureSource = Join-Path $fixtureUpstream 'design-md/elevenlabs'
    New-Item -ItemType Directory -Path $fixtureSource -Force | Out-Null
    "# Fixture design reference`n" | Set-Content -LiteralPath (Join-Path $fixtureSource 'DESIGN.md') -Encoding utf8
    & git -C $fixtureUpstream init -b main | Out-Null
    & git -C $fixtureUpstream add design-md/elevenlabs/DESIGN.md
    & git -C $fixtureUpstream -c user.name=fixture -c user.email=fixture@example.invalid commit -m fixture | Out-Null
    $fixtureCommit = (& git -C $fixtureUpstream rev-parse HEAD).Trim()
    $fixtureCatalogPath = Join-Path $fixtureRoot 'catalog.json'
    $fixtureCatalog = Get-Content -LiteralPath $catalog -Raw | ConvertFrom-Json -Depth 20
    $fixtureCatalog.source.commit = $fixtureCommit
    foreach ($entry in $fixtureCatalog.entries) { $entry.source_commit = $fixtureCommit }
    $fixtureCatalog | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixtureCatalogPath -Encoding utf8

    & (Join-Path $Root 'scripts/install-design-reference.ps1') -Id elevenlabs -TargetRoot $fixtureRoot -CatalogPath $fixtureCatalogPath -UpstreamPath $fixtureUpstream | Out-Null
    $installed = Join-Path $fixtureRoot 'design-references/elevenlabs/DESIGN.md'
    $provenancePath = Join-Path $fixtureRoot 'design-references/elevenlabs/provenance.json'
    if (-not (Test-Path -LiteralPath $installed) -or -not (Test-Path -LiteralPath $provenancePath)) { throw 'Design install omitted content or provenance.' }
    $provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
    if ($provenance.sha256 -ne (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Installed design hash does not match provenance.' }
    try {
        & (Join-Path $Root 'scripts/install-design-reference.ps1') -Id missing-design -TargetRoot $fixtureRoot -CatalogPath $fixtureCatalogPath -UpstreamPath $fixtureUpstream 2>&1 | Out-Null
        throw 'Unknown design id should fail.'
    }
    catch { if (($_ | Out-String) -notmatch 'Unknown design reference') { throw } }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
Write-Output 'Design catalog search, product recommendation, install, and provenance cases passed.'
