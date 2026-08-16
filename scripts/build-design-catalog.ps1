[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$UpstreamPath,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($UpstreamPath)) { $UpstreamPath = Join-Path $Root 'upstreams/awesome-design-md' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $Root 'design/catalog.json' }
if (-not (Test-Path -LiteralPath (Join-Path $UpstreamPath '.git'))) { throw "awesome-design-md mirror not found: $UpstreamPath" }

$commit = (& git -C $UpstreamPath rev-parse HEAD).Trim()
$remote = (& git -C $UpstreamPath remote get-url origin).Trim() -replace '\.git$', ''
$commitDate = (& git -C $UpstreamPath show -s --format=%cI HEAD).Trim()
$licensePath = Join-Path $UpstreamPath 'LICENSE'
if (-not (Test-Path -LiteralPath $licensePath) -or (Get-Content -LiteralPath $licensePath -Raw) -notmatch 'MIT License') {
    throw 'The pinned design source must contain an MIT License before catalog generation.'
}

$categoryAliases = @{
    'AI & LLM Platforms' = 'ai-llm'
    'Developer Tools & IDEs' = 'developer-tools'
    'Backend, Database & DevOps' = 'backend-devops'
    'Productivity & SaaS' = 'productivity-saas'
    'Design & Creative Tools' = 'design-creative'
    'Fintech & Crypto' = 'fintech-crypto'
    'E-commerce & Retail' = 'ecommerce-retail'
    'Media & Consumer Tech' = 'media-consumer'
    'Automotive' = 'automotive'
    'Retro Web · DESIGN.md Nostalgia' = 'retro-web'
}
$categoryById = @{}
$currentCategory = 'unclassified'
foreach ($line in Get-Content -LiteralPath (Join-Path $UpstreamPath 'README.md')) {
    $heading = [regex]::Match($line, '^###\s+(?<name>.+?)\s*$')
    if ($heading.Success -and $categoryAliases.ContainsKey($heading.Groups['name'].Value)) {
        $currentCategory = $categoryAliases[$heading.Groups['name'].Value]
        continue
    }
    $link = [regex]::Match($line, 'https://getdesign\.md/(?<id>[^/\)]+)/design-md')
    if ($link.Success) { $categoryById[$link.Groups['id'].Value] = $currentCategory }
}

$entries = foreach ($directory in Get-ChildItem -LiteralPath (Join-Path $UpstreamPath 'design-md') -Directory | Sort-Object Name) {
    $designPath = Join-Path $directory.FullName 'DESIGN.md'
    if (-not (Test-Path -LiteralPath $designPath)) { continue }
    $content = Get-Content -LiteralPath $designPath -Raw
    $nameMatch = [regex]::Match($content, '(?m)^name:\s*(?<value>.+?)\s*$')
    $descriptionMatch = [regex]::Match($content, '(?m)^description:\s*(?<value>.+?)\s*$')
    $title = if ($nameMatch.Success) { $nameMatch.Groups['value'].Value -replace '-design-analysis$', '' -replace '-', ' ' } else { $directory.Name -replace '[.-]', ' ' }
    $category = if ($categoryById.ContainsKey($directory.Name)) { $categoryById[$directory.Name] } else { 'unclassified' }
    [ordered]@{
        id = $directory.Name
        title = $title
        category = $category
        description = if ($descriptionMatch.Success) { $descriptionMatch.Groups['value'].Value } else { "Pinned design-system reference for $title." }
        source_url = "https://getdesign.md/$($directory.Name)/design-md"
        source_path = "design-md/$($directory.Name)/DESIGN.md"
        source_commit = $commit
        license = 'MIT'
        tags = @($category, $directory.Name, ($title.ToLowerInvariant() -replace '\s+', '-')) | Select-Object -Unique
    }
}

$catalog = [ordered]@{
    schema = 'design-reference-catalog/v1'
    generated_at = $commitDate
    source = [ordered]@{ repository = $remote; commit = $commit; license = 'MIT'; entry_count = @($entries).Count }
    entries = @($entries)
}
$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$catalog | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Built design catalog with $(@($entries).Count) entries at $OutputPath."
