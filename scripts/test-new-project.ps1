[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
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
        'quality/gates.json',
        'TESTING.md',
        '.kest/flow/governance-smoke.flow.md',
        '.kest/flow.config.yaml',
        'CHANGELOG.md',
        'DESIGN-SOURCES.md',
        'VERSION',
        'design/catalog.json',
        'docs/AGENT_PLATFORM_BOUNDARY.md',
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

    $config = Get-Content -LiteralPath (Join-Path $destination 'quality/gates.json') -Raw | ConvertFrom-Json -Depth 20
    if ($config.projectKind -ne 'web') { throw 'Generated quality manifest did not retain the project type.' }
    if ($config.gates.id -contains 'template-bootstrap') {
        throw 'Generated project must not retain the template bootstrap self-test.'
    }
    $productFunctional = $config.gates | Where-Object id -eq 'product-functional'
    if ($productFunctional.state -ne 'planned' -or $productFunctional.requiredBeforeRelease -ne $true) {
        throw 'Generated project must replace the template self-test with a release-blocking product functional gate.'
    }

    $productCategories = @(
        'unit', 'integration', 'contract', 'e2e', 'accessibility', 'performance',
        'dependency-security', 'container-security', 'compatibility', 'deployment', 'data-quality'
    )
    foreach ($category in $productCategories) {
        $decision = @($config.gates | Where-Object category -eq $category)
        if ($decision.Count -eq 0 -or 'planned' -notin $decision.state) {
            throw "Generated project did not mark '$category' as a release-blocking planned gate."
        }
    }

    $releaseOutput = & pwsh -NoProfile -File (Join-Path $destination 'scripts/invoke-quality-gates.ps1') `
        -Profile release -Root $destination 2>&1
    if ($LASTEXITCODE -eq 0) { throw 'A generated project with planned gates must not pass release readiness.' }
    if (($releaseOutput -join "`n") -notmatch 'Release is blocked by unconfigured required gates') {
        throw "Release readiness failed for an unexpected reason: $($releaseOutput -join ' ')"
    }

    Write-Output 'New-project functional test passed.'
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
