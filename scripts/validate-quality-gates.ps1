[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'quality/gates.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing quality gate manifest: $configPath" }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -Depth 20
if ($config.schema -ne 'quality-gates/v1') { throw "Unsupported quality gate schema '$($config.schema)'." }
if ([string]::IsNullOrWhiteSpace($config.projectKind)) { throw 'quality/gates.json requires projectKind.' }
if (-not $config.requiredCategories -or -not $config.gates) { throw 'quality/gates.json requires requiredCategories and gates.' }

$canonicalCategories = @(
    'requirements', 'governance', 'functional', 'unit', 'integration', 'contract',
    'e2e', 'accessibility', 'performance', 'security', 'dependency-security',
    'container-security', 'compatibility', 'deployment', 'qualitative', 'data-quality'
)
foreach ($category in $canonicalCategories) {
    if ($category -notin $config.requiredCategories) {
        throw "Canonical quality category was removed from requiredCategories: $category"
    }
}

$allowedStates = @('active', 'planned', 'not-applicable')
$allowedProfiles = @('pr', 'release', 'nightly', 'qualitative', 'performance')
$allowedPriorities = @('P0', 'P1', 'P2', 'P3')
$ids = @{}
$categories = @{}
$storyRoot = Join-Path $Root 'requirements/user-stories'

foreach ($gate in $config.gates) {
    if ([string]::IsNullOrWhiteSpace($gate.id) -or $gate.id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
        throw "Invalid quality gate id '$($gate.id)'."
    }
    if ($ids.ContainsKey($gate.id)) { throw "Duplicate quality gate id '$($gate.id)'." }
    $ids[$gate.id] = $true
    if ([string]::IsNullOrWhiteSpace($gate.category)) { throw "$($gate.id): category is required." }
    $categories[$gate.category] = $true
    if ($gate.state -notin $allowedStates) { throw "$($gate.id): unsupported state '$($gate.state)'." }

    $hasStory = -not [string]::IsNullOrWhiteSpace($gate.userStory)
    $hasCriteria = $null -ne $gate.acceptanceCriteria -and @($gate.acceptanceCriteria).Count -gt 0
    if ($hasStory -xor $hasCriteria) {
        throw "$($gate.id): userStory and acceptanceCriteria must be declared together."
    }
    if ($hasStory) {
        if ($gate.userStory -notmatch '^US-\d{3,}$') { throw "$($gate.id): invalid userStory '$($gate.userStory)'." }
        $storyFiles = @(Get-ChildItem -LiteralPath $storyRoot -File -Filter "$($gate.userStory)-*.md")
        if ($storyFiles.Count -ne 1) {
            throw "$($gate.id): userStory '$($gate.userStory)' must resolve to exactly one Story file."
        }
        $storyBody = Get-Content -LiteralPath $storyFiles[0].FullName -Raw
        $storyCriteria = @([regex]::Matches($storyBody, '(?m)^### (?<id>AC-\d{3,}):') | ForEach-Object { $_.Groups['id'].Value })
        foreach ($criterion in @($gate.acceptanceCriteria)) {
            if ($criterion -notmatch '^AC-\d{3,}$' -or $criterion -notin $storyCriteria) {
                throw "$($gate.id): acceptance criterion '$criterion' does not exist in $($gate.userStory)."
            }
        }
    }

    if ($gate.state -eq 'active') {
        if (-not $gate.profiles -or -not $gate.command) { throw "$($gate.id): active gates require profiles and command." }
        if ($gate.failurePriority -notin $allowedPriorities) { throw "$($gate.id): active gates require failurePriority P0-P3." }
        if ([string]::IsNullOrWhiteSpace($gate.owner)) { throw "$($gate.id): active gates require owner." }
        if ([string]::IsNullOrWhiteSpace($gate.remediation)) { throw "$($gate.id): active gates require remediation." }
        foreach ($profile in $gate.profiles) {
            if ($profile -notin $allowedProfiles) { throw "$($gate.id): unsupported profile '$profile'." }
        }
        if ([string]::IsNullOrWhiteSpace($gate.command.executable)) {
            throw "$($gate.id): active gate command requires executable."
        }
        if ($null -ne $gate.command.arguments -and $gate.command.arguments -isnot [System.Array]) {
            throw "$($gate.id): command.arguments must be an array."
        }
    }
    else {
        if ([string]::IsNullOrWhiteSpace($gate.rationale)) {
            throw "$($gate.id): $($gate.state) gates require a rationale."
        }
        if ($gate.state -eq 'planned' -and $gate.requiredBeforeRelease -ne $true) {
            throw "$($gate.id): planned gates must set requiredBeforeRelease=true."
        }
        if ($gate.state -eq 'planned') {
            if ($gate.failurePriority -notin $allowedPriorities) { throw "$($gate.id): planned gates require failurePriority P0-P3." }
            if ([string]::IsNullOrWhiteSpace($gate.owner)) { throw "$($gate.id): planned gates require owner." }
            if ([string]::IsNullOrWhiteSpace($gate.remediation)) { throw "$($gate.id): planned gates require remediation." }
        }
    }
}

foreach ($category in $config.requiredCategories) {
    if (-not $categories.ContainsKey($category)) {
        throw "Required quality category has no explicit decision: $category"
    }
}

Write-Output "Validated $($config.gates.Count) quality gate decisions across $($config.requiredCategories.Count) required categories."
