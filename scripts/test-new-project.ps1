[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'project-kind-quality-policy.ps1')

$expectedPolicy = @{
    web = @('e2e', 'accessibility', 'performance', 'dependency-security', 'compatibility', 'deployment')
    api = @('contract', 'e2e', 'performance', 'dependency-security', 'compatibility', 'deployment')
    cli = @('contract', 'e2e', 'dependency-security', 'compatibility', 'deployment')
    research = @('e2e', 'dependency-security', 'compatibility', 'data-quality')
    other = @()
}
foreach ($projectKind in $expectedPolicy.Keys) {
    $actual = @(Get-ProjectKindQualityPolicy -ProjectType $projectKind |
        Where-Object RequiredBeforeRelease |
        ForEach-Object Category)
    if (Compare-Object -ReferenceObject @($expectedPolicy[$projectKind]) -DifferenceObject $actual) {
        throw "Unexpected release policy for project type '$projectKind': $($actual -join ', ')"
    }
}
$tempBase = [IO.Path]::GetTempPath()
$testRoot = Join-Path $tempBase ("governance-template-test-" + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $testRoot 'story-tested-web'
$expectedPrefix = [IO.Path]::GetFullPath($tempBase).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $previousGitAuthorName = $env:GIT_AUTHOR_NAME
    $previousGitAuthorEmail = $env:GIT_AUTHOR_EMAIL
    $previousGitCommitterName = $env:GIT_COMMITTER_NAME
    $previousGitCommitterEmail = $env:GIT_COMMITTER_EMAIL
    $previousGitConfigCount = $env:GIT_CONFIG_COUNT
    $previousGitConfigKey = $env:GIT_CONFIG_KEY_0
    $previousGitConfigValue = $env:GIT_CONFIG_VALUE_0
    $env:GIT_AUTHOR_NAME = 'Governance Template Test'
    $env:GIT_AUTHOR_EMAIL = 'template-test@example.invalid'
    $env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME
    $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL
    $env:GIT_CONFIG_COUNT = '1'
    $env:GIT_CONFIG_KEY_0 = 'core.autocrlf'
    $env:GIT_CONFIG_VALUE_0 = 'false'

    & (Join-Path $Root 'scripts/new-project.ps1') `
        -ProjectName 'story-tested-web' `
        -DisplayName 'Story Tested Web' `
        -Audience 'a test developer' `
        -Outcome 'observe a generated quality system' `
        -FirstSlice 'brief -> repository -> verified project files' `
        -ProjectType web `
        -Destination $destination `
        -TemplateRoot $Root `
        -UseWorkingTree `
        -NonInteractive

    foreach ($relativePath in @(
        'PROJECT_BRIEF.md',
        'requirements/user-stories/US-001-first-slice.md',
        'requirements/test-runs/TEMPLATE.md',
        'requirements/user-journeys/TEMPLATE.md',
        'requirements/plans/TEMPLATE.md',
        'requirements/plans/US-001-first-slice.md',
        'quality/gates.json',
        'scripts/project-kind-quality-policy.ps1',
        'TESTING.md',
        '.kest/flow/governance-smoke.flow.md',
        '.kest/flow.config.yaml',
        'CHANGELOG.md',
        'DESIGN-SOURCES.md',
        'VERSION',
        'design/catalog.json',
        'docs/AGENT_PLATFORM_BOUNDARY.md',
        'docs/DOCUMENTATION_AUTHORITY.md',
        'docs/PROJECT_LIFECYCLE.md',
        'docs/RESOURCE_REGISTRY.md',
        'docs/RELEASING.md',
        'package.json',
        'package-lock.json',
        'site/index.html',
        'site/styles.css',
        'site/app.js',
        'upstreams.lock.json'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $destination $relativePath))) {
            throw "Generated project is missing $relativePath"
        }
    }

    $storyOutput = & pwsh -NoProfile -File (Join-Path $destination 'scripts/validate-user-stories.ps1') -Root $destination 2>&1
    if ($LASTEXITCODE -ne 0 -or ($storyOutput -join "`n") -notmatch 'Validated 1 user stories') {
        throw "Generated first Story does not satisfy the executable test-design contract: $($storyOutput -join ' ')"
    }
    $copiedTestRuns = @(Get-ChildItem -LiteralPath (Join-Path $destination 'requirements/test-runs') -File -Filter '*.md' |
        Where-Object Name -ne 'TEMPLATE.md')
    if ($copiedTestRuns.Count -gt 0) {
        throw "Generated project retained template execution history: $($copiedTestRuns.Name -join ', ')"
    }

    $config = Get-Content -LiteralPath (Join-Path $destination 'quality/gates.json') -Raw | ConvertFrom-Json -Depth 20
    if ($config.projectKind -ne 'web') { throw 'Generated quality manifest did not retain the project type.' }
    if ($config.gates.id -contains 'template-bootstrap') {
        throw 'Generated project must not retain the template bootstrap self-test.'
    }
    $productFunctional = $config.gates | Where-Object id -eq 'product-functional'
    if ($productFunctional.state -ne 'planned' -or $productFunctional.requiredBeforeRelease -ne $true) {
        throw 'Generated project must replace the template self-test with a release-blocking product functional gate.'
    }
    $storyTraceability = $config.gates | Where-Object id -eq 'story-traceability'
    if ($storyTraceability.userStory -ne 'US-001' -or @($storyTraceability.acceptanceCriteria).Count -ne 2) {
        throw 'Generated story-traceability gate must map to the generated US-001 acceptance criteria.'
    }
    $staleStoryLinks = @($config.gates | Where-Object { $null -ne $_.userStory -and $_.userStory -ne 'US-001' })
    if ($staleStoryLinks.Count -gt 0) {
        throw "Generated project retained stale template Story links: $($staleStoryLinks.id -join ', ')"
    }

    $expectedPlanned = @('functional') + @($expectedPolicy.web)
    $productDecisions = @($config.gates | Where-Object id -like 'product-*')
    foreach ($category in @('functional', 'unit', 'integration', 'contract', 'e2e', 'accessibility', 'performance', 'dependency-security', 'container-security', 'compatibility', 'deployment', 'data-quality')) {
        $decision = @($productDecisions | Where-Object category -eq $category)
        if ($decision.Count -ne 1) { throw "Generated project must have one product decision for '$category'." }
        $expectedState = if ($category -in $expectedPlanned) { 'planned' } else { 'not-applicable' }
        if ($decision[0].state -ne $expectedState) {
            throw "Generated web project marked '$category' as '$($decision[0].state)' instead of '$expectedState'."
        }
    }
    $activePrGates = @($config.gates | Where-Object { $_.state -eq 'active' -and 'pr' -in $_.profiles })
    $expectedActivePr = @('governance-structure', 'skill-packages', 'document-integrity', 'story-traceability', 'security-baseline')
    if (Compare-Object -ReferenceObject $expectedActivePr -DifferenceObject @($activePrGates.id)) {
        throw "Generated project has unexpected routine PR gates: $($activePrGates.id -join ', ')"
    }
    $qualitative = $config.gates | Where-Object id -eq 'llm-qualitative'
    if ($qualitative.state -ne 'not-applicable') {
        throw 'A qualitative gate that was not selected must not block release.'
    }

    $releaseOutput = & pwsh -NoProfile -File (Join-Path $destination 'scripts/invoke-quality-gates.ps1') `
        -Profile release -Root $destination 2>&1
    if ($LASTEXITCODE -eq 0) { throw 'A generated project with planned gates must not pass release readiness.' }
    if (($releaseOutput -join "`n") -notmatch 'Release is blocked by unconfigured required gates') {
        throw "Release readiness failed for an unexpected reason: $($releaseOutput -join ' ')"
    }

    Write-Output 'New-project functional test passed.'
    $global:LASTEXITCODE = 0
}
finally {
    $env:GIT_AUTHOR_NAME = $previousGitAuthorName
    $env:GIT_AUTHOR_EMAIL = $previousGitAuthorEmail
    $env:GIT_COMMITTER_NAME = $previousGitCommitterName
    $env:GIT_COMMITTER_EMAIL = $previousGitCommitterEmail
    $env:GIT_CONFIG_COUNT = $previousGitConfigCount
    $env:GIT_CONFIG_KEY_0 = $previousGitConfigKey
    $env:GIT_CONFIG_VALUE_0 = $previousGitConfigValue
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot).StartsWith('governance-template-test-', [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
