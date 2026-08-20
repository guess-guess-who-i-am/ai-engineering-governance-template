[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ProjectName,
    [string]$DisplayName,
    [string]$Audience,
    [string]$Outcome,
    [string]$FirstSlice,
    [ValidateSet('web', 'api', 'cli', 'research', 'other')]
    [string]$ProjectType = 'other',
    [string]$Destination,
    [string]$GitHubOwner,
    [switch]$CreateGitHub,
    [switch]$IncludeQualitativeGate,
    [switch]$UseWorkingTree,
    [switch]$NonInteractive,
    [string]$TemplateRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'project-kind-quality-policy.ps1')

function Get-RequiredValue {
    param([string]$Value, [string]$Prompt, [string]$Name)

    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        return (($Value.Trim() -replace '\r?\n', ' ') -replace '\s{2,}', ' ')
    }
    if ($NonInteractive) {
        throw "$Name is required in non-interactive mode."
    }

    do {
        $Value = Read-Host $Prompt
    } while ([string]::IsNullOrWhiteSpace($Value))
    return (($Value.Trim() -replace '\r?\n', ' ') -replace '\s{2,}', ' ')
}

function Invoke-CheckedCommand {
    param([string]$Command, [string[]]$Arguments, [string]$FailureMessage)

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

$ProjectName = Get-RequiredValue $ProjectName 'Repository name (lowercase kebab-case)' 'ProjectName'
if ($ProjectName -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
    throw "ProjectName must use lowercase kebab-case, for example 'paper-assistant'."
}
$DisplayName = if ([string]::IsNullOrWhiteSpace($DisplayName)) { $ProjectName } else { Get-RequiredValue $DisplayName '' 'DisplayName' }
$Audience = Get-RequiredValue $Audience 'Who is the intended user?' 'Audience'
$Outcome = Get-RequiredValue $Outcome 'What observable result should the user obtain?' 'Outcome'
$FirstSlice = Get-RequiredValue $FirstSlice 'What is the first end-to-end slice?' 'FirstSlice'

if (-not $PSBoundParameters.ContainsKey('ProjectType') -and -not $NonInteractive) {
    $typeAnswer = Read-Host 'Project type: web, api, cli, research, or other [other]'
    if (-not [string]::IsNullOrWhiteSpace($typeAnswer)) {
        if ($typeAnswer -notin @('web', 'api', 'cli', 'research', 'other')) {
            throw "Unsupported project type '$typeAnswer'."
        }
        $ProjectType = $typeAnswer
    }
}

$templatePath = [IO.Path]::GetFullPath($TemplateRoot)
if (-not (Test-Path -LiteralPath (Join-Path $templatePath '.git'))) {
    throw "TemplateRoot is not a Git repository: $templatePath"
}

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path (Split-Path -Parent $templatePath) $ProjectName
}
$destinationPath = [IO.Path]::GetFullPath($Destination)
$templatePrefix = $templatePath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($destinationPath -eq $templatePath -or $destinationPath.StartsWith($templatePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The new project must be outside the governance-template repository.'
}
if (Test-Path -LiteralPath $destinationPath) {
    $existing = @(Get-ChildItem -LiteralPath $destinationPath -Force -ErrorAction Stop)
    if ($existing.Count -gt 0) {
        throw "Destination already exists and is not empty: $destinationPath"
    }
}
else {
    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
}

$tempBase = [IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempBase ("governance-bootstrap-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tempRoot 'template.zip'
$extractPath = Join-Path $tempRoot 'source'

try {
    $sourceRoot = $templatePath
    if (-not $UseWorkingTree) {
        New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
        Invoke-CheckedCommand 'git' @('-C', $templatePath, 'archive', '--format=zip', "--output=$archivePath", 'HEAD') 'Could not export the committed governance template'
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
        $sourceRoot = $extractPath
    }

    $includedRoots = @(
        '.agents', '.github', '.kest', 'design', 'docs', 'qualitative', 'quality',
        'requirements', 'scripts', 'site',
        '.gitignore', 'AGENTS.md', 'CONTEXT.md', 'DESIGN.md', 'LICENSE',
        'README.md', 'TESTING.md', 'UPSTREAMS.md', 'WORKFLOW.md',
        'CHANGELOG.md', 'DESIGN-SOURCES.md', 'VERSION', 'package.json',
        'package-lock.json', 'upstreams.lock.json'
    )
    $sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force
    foreach ($sourceFile in $sourceFiles) {
        $relative = [IO.Path]::GetRelativePath($sourceRoot, $sourceFile.FullName)
        $normalized = $relative.Replace('\', '/')
        $include = $false
        foreach ($root in $includedRoots) {
            if ($normalized -eq $root -or $normalized.StartsWith("$root/", [StringComparison]::Ordinal)) {
                $include = $true
                break
            }
        }
        if (-not $include) { continue }
        if (-not $IncludeQualitativeGate -and $normalized -eq '.github/workflows/qualitative-gate.yml') {
            continue
        }

        $target = Join-Path $destinationPath $relative
        $targetParent = Split-Path -Parent $target
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        Copy-Item -LiteralPath $sourceFile.FullName -Destination $target -Force
    }
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    if ($resolvedTemp.StartsWith([IO.Path]::GetFullPath($tempBase), [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTemp).StartsWith('governance-bootstrap-', [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$brief = @"
# Project Brief

## Outcome

**$DisplayName** enables **$Audience** to **$Outcome**.

## First End-to-End Slice

$FirstSlice

## Project Shape

- Repository: $ProjectName
- Type: $ProjectType
- Visibility: private

## Current Boundaries

- Included: the first end-to-end slice and evidence that its real consumer can use it.
- Excluded: features, integrations, and abstractions not required by that slice.

## Decisions To Fill With Codex

- Domain terms and ownership in CONTEXT.md.
- Technical architecture after inspecting the first slice's real constraints.
- Acceptance criteria and evidence mapping in requirements/user-stories/.
- Cross-Story journeys in requirements/user-journeys/ only when the result spans multiple boundaries.
- High-impact implementation and rollback decisions in requirements/plans/ only when needed.
- Persistent, scarce, paid, privileged, or data-bearing resources in docs/RESOURCE_REGISTRY.md.
- Product-specific gates in quality/gates.json; planned gates block release.
- Visual language in DESIGN.md when the project has a user interface.
"@
Set-Content -LiteralPath (Join-Path $destinationPath 'PROJECT_BRIEF.md') -Value $brief -Encoding utf8

$context = @"
# Project Context

## Outcome

**$DisplayName** serves $Audience. The observable outcome is: $Outcome

## First Slice

$FirstSlice

## Canonical Terms

Fill this section with Codex when the first domain objects are known. Define each term once and name its owner.

## Ownership And Boundaries

- User intent defines success.
- The component that creates a domain fact owns that fact.
- Public behavior belongs in an explicit contract and must be verified through a real consumer.
"@
Set-Content -LiteralPath (Join-Path $destinationPath 'CONTEXT.md') -Value $context -Encoding utf8

$agents = @"
# AGENTS.md

This repository implements **$DisplayName** for **$Audience**.

## Task Routing

1. Check git status, the user's latest request, the nearest implementation, and its tests.
2. Read PROJECT_BRIEF.md for product outcome and current scope.
3. Read CONTEXT.md for domain terms, ownership, and boundaries.
4. Read DESIGN.md only for user-interface work.
5. Read TESTING.md and the relevant user story when changing product behavior or test coverage.
6. Read docs/DOCUMENTATION_AUTHORITY.md when fact ownership is unclear, docs/PROJECT_LIFECYCLE.md for project or release gates, and docs/RESOURCE_REGISTRY.md for persistent or shared resources.
7. Load one matching Skill from .agents/skills only when its description clearly applies.
8. Put mechanically decidable rules in tests, scripts, schemas, or contracts.

## Implementation Flow

1. Confirm the real consumer and the first information-flow boundary.
2. Build the smallest end-to-end slice before adding variants or abstractions.
3. Verify the narrowest observable claim first; add contract or end-to-end evidence across boundaries.
4. Report the result, evidence, limits, and next unresolved risk.

## Repository Rules

- Do not commit tokens, cookies, API keys, .env, or machine-local configuration.
- Preserve unrelated user changes and avoid destructive Git operations.
- Do not claim completion without current evidence.
- Keep main verifiable and use short-lived branches for independent changes.
"@
Set-Content -LiteralPath (Join-Path $destinationPath 'AGENTS.md') -Value $agents -Encoding utf8

$readme = @"
# $DisplayName

$Outcome

## Intended User

$Audience

## First Slice

$FirstSlice

See PROJECT_BRIEF.md for scope and unresolved decisions.

Run repository checks with: ./scripts/check.ps1
Run release readiness with: ./scripts/invoke-quality-gates.ps1 -Profile release
"@
Set-Content -LiteralPath (Join-Path $destinationPath 'README.md') -Value $readme -Encoding utf8

$storyRoot = Join-Path $destinationPath 'requirements/user-stories'
Get-ChildItem -LiteralPath $storyRoot -File -Filter 'US-*.md' |
    Where-Object { $_.Name -ne 'TEMPLATE.md' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$testRunRoot = Join-Path $destinationPath 'requirements/test-runs'
Get-ChildItem -LiteralPath $testRunRoot -File -Filter '*.md' |
    Where-Object { $_.Name -ne 'TEMPLATE.md' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$firstStory = @"
---
id: US-001
status: ready
risk: high
---

# US-001: $FirstSlice

## 用户故事

- Actor: $Audience
- Need: $Outcome
- Value: 通过一条真实的端到端路径获得可观察结果

## 验收条件

### AC-001: 第一条成功路径

- Type: happy
- Given: 项目依赖和运行环境已经按仓库说明准备
- When: 用户执行 $FirstSlice
- Then: 用户能够观察到 $Outcome

### AC-002: 相关失败路径

- Type: failure
- Given: 输入、权限、依赖或环境不满足第一条路径的要求
- When: 用户尝试执行同一能力
- Then: 系统给出稳定、无敏感信息泄漏且可恢复的失败结果

## 证据映射

- AC-001: planned: 技术栈确定后选择穿过真实消费者边界的测试
- AC-002: planned: 技术栈确定后加入失败语义和恢复路径测试

## 测试设计重点

- 主成功路径: AC-001: 从真实入口执行第一条闭环并检查用户可见输出
- 重要失败与恢复: AC-002: 触发当前最重要的输入、权限、依赖或环境失败并证明可恢复
- 变更影响面: 第一条闭环直接影响真实入口和用户输出；技术栈确定后只补实际存在的数据、权限、重复操作、兼容或性能风险

## 非目标

- 不包含 PROJECT_BRIEF.md 中未纳入第一条闭环的相邻能力。
"@
Set-Content -LiteralPath (Join-Path $storyRoot 'US-001-first-slice.md') -Value $firstStory -Encoding utf8

$planRoot = Join-Path $destinationPath 'requirements/plans'
Get-ChildItem -LiteralPath $planRoot -File -Filter 'US-*.md' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'TEMPLATE.md' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$firstPlan = @"
# US-001 Build Plan

Use this plan only while the first slice still has high-impact ambiguity, crosses a contract or data boundary, or needs rollout and recovery decisions. Delete it when none of those conditions apply.

## Outcome

$Audience can $Outcome through: $FirstSlice

## Scope

- Included: the first end-to-end slice and its observable success and failure behavior.
- Excluded: adjacent features and abstractions not required by US-001.

## Information Flow

input -> validation -> product behavior -> consumer-visible result -> evidence

## Contracts, Data, And Resources

- Fill only the boundaries and RES-nnn resources actually used by this slice.

## Verification

- AC-001: run through the real consumer boundary.
- AC-002: verify stable, non-sensitive, recoverable failure behavior.

## Risk And Rollback

- Record irreversible effects, activation order, observation signals, and recovery only when applicable.
"@
Set-Content -LiteralPath (Join-Path $planRoot 'US-001-first-slice.md') -Value $firstPlan -Encoding utf8

$qualityPath = Join-Path $destinationPath 'quality/gates.json'
$quality = Get-Content -LiteralPath $qualityPath -Raw | ConvertFrom-Json -Depth 20
$quality.projectKind = $ProjectType
$productPolicy = @(Get-ProjectKindQualityPolicy -ProjectType $ProjectType)
$productCategories = @($productPolicy.Category)
$downstreamActiveGateIds = @(
    'governance-structure', 'skill-packages', 'document-integrity',
    'story-traceability', 'security-baseline'
)
$quality.gates = @($quality.gates | Where-Object {
    $_.category -notin $productCategories -and
    ($_.id -in $downstreamActiveGateIds -or $_.id -in @('application-security', 'llm-qualitative'))
})
foreach ($gate in $quality.gates) {
    if ($gate.id -eq 'story-traceability') {
        $gate.userStory = 'US-001'
        $gate.acceptanceCriteria = @('AC-001', 'AC-002')
    }
    elseif ($gate.id -eq 'application-security' -and $gate.state -eq 'not-applicable') {
        $gate.rationale = 'Enable when the product adds authentication, authorization, privileged actions, private user data, abuse boundaries, or sensitive telemetry.'
    }
    elseif ($gate.id -eq 'llm-qualitative' -and -not $IncludeQualitativeGate) {
        $gate.state = 'not-applicable'
        $gate | Add-Member -NotePropertyName rationale -NotePropertyValue 'The qualitative gate was not selected for this project. Enable it when taste, intent, or another non-numeric product requirement needs calibrated model evaluation.' -Force
        $gate.PSObject.Properties.Remove('profiles')
        $gate.PSObject.Properties.Remove('workingDirectory')
        $gate.PSObject.Properties.Remove('command')
    }
    elseif ($gate.id -eq 'llm-qualitative' -and $IncludeQualitativeGate) {
        $gate.state = 'planned'
        $gate | Add-Member -NotePropertyName requiredBeforeRelease -NotePropertyValue $true -Force
        $gate | Add-Member -NotePropertyName rationale -NotePropertyValue 'Calibrate the qualitative manifest against the product, then configure LLM_BASE_URL and LLM_API_KEY.' -Force
        $gate.PSObject.Properties.Remove('profiles')
        $gate.PSObject.Properties.Remove('workingDirectory')
        $gate.PSObject.Properties.Remove('command')
    }
    if ($gate.state -eq 'planned') {
        if ($null -eq $gate.failurePriority) { $gate | Add-Member -NotePropertyName failurePriority -NotePropertyValue 'P1' -Force }
        if ([string]::IsNullOrWhiteSpace($gate.owner)) { $gate | Add-Member -NotePropertyName owner -NotePropertyValue 'project-maintainers' -Force }
        if ([string]::IsNullOrWhiteSpace($gate.remediation)) {
            $gate | Add-Member -NotePropertyName remediation -NotePropertyValue "Configure and pass the $($gate.id) gate before release." -Force
        }
    }
    if ($null -ne $gate.userStory -and $gate.userStory -ne 'US-001') {
        $gate.PSObject.Properties.Remove('userStory')
        $gate.PSObject.Properties.Remove('acceptanceCriteria')
    }
}

$quality.gates += [pscustomobject]@{
    id = 'product-functional'
    category = 'functional'
    state = 'planned'
    rationale = 'Configure the first user-visible success and important failure paths after choosing the application stack.'
    requiredBeforeRelease = $true
    failurePriority = 'P1'
    owner = 'project-maintainers'
    remediation = 'Implement and pass the first real product flow before release.'
}
foreach ($decision in $productPolicy) {
    $productGate = [ordered]@{
        id = "product-$($decision.Category)"
        category = $decision.Category
        state = if ($decision.RequiredBeforeRelease) { 'planned' } else { 'not-applicable' }
        rationale = $decision.Rationale
    }
    if ($decision.RequiredBeforeRelease) {
        $productGate.requiredBeforeRelease = $true
        $productGate.failurePriority = 'P1'
        $productGate.owner = 'project-maintainers'
        $productGate.remediation = "Implement and pass the product-level $($decision.Category) gate before release."
    }
    $quality.gates += [pscustomobject]$productGate
}
$quality | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $qualityPath -Encoding utf8

Invoke-CheckedCommand 'git' @('-C', $destinationPath, 'init', '-b', 'main') 'Could not initialize Git'
Invoke-CheckedCommand 'git' @('-C', $destinationPath, 'add', '--all') 'Could not stage generated files for validation'
& (Join-Path $destinationPath 'scripts/check.ps1') -Root $destinationPath
if ($LASTEXITCODE -ne 0) {
    throw 'Generated project failed repository checks.'
}

Invoke-CheckedCommand 'git' @('-C', $destinationPath, 'commit', '-m', 'chore: initialize project') 'Could not create the initial commit'

if (-not $CreateGitHub -and -not $NonInteractive) {
    $answer = Read-Host 'Create and push a private GitHub repository now? [y/N]'
    $CreateGitHub = $answer -match '^(?i:y|yes)$'
}

$githubRepository = $null
if ($CreateGitHub) {
    Invoke-CheckedCommand 'gh' @('auth', 'status') 'GitHub CLI is not authenticated'
    if ([string]::IsNullOrWhiteSpace($GitHubOwner)) {
        $GitHubOwner = (& gh api user --jq .login).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($GitHubOwner)) {
            throw 'Could not determine the authenticated GitHub owner.'
        }
    }
    $githubRepository = "$GitHubOwner/$ProjectName"
    if ($PSCmdlet.ShouldProcess($githubRepository, 'Create private GitHub repository and push main')) {
        Invoke-CheckedCommand 'gh' @(
            'repo', 'create', $githubRepository, '--private',
            "--source=$destinationPath", '--remote=origin', '--push',
            '--description', $Outcome
        ) 'Could not create or push the private GitHub repository; the local project is preserved'
    }
}

[pscustomobject]@{
    ProjectPath = $destinationPath
    ProjectName = $ProjectName
    GitInitialized = $true
    GitHubRepository = $githubRepository
    Brief = (Join-Path $destinationPath 'PROJECT_BRIEF.md')
}
