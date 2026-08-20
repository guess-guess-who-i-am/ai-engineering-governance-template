[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$runRoot = Join-Path $Root 'requirements/test-runs'
if (-not (Test-Path -LiteralPath $runRoot -PathType Container)) {
    throw "Missing test-run directory: $runRoot"
}

$runs = @(Get-ChildItem -LiteralPath $runRoot -File -Filter '*.md' |
    Where-Object Name -ne 'TEMPLATE.md' |
    Sort-Object Name)
$allowedStatuses = @('passed', 'failed', 'blocked')
$storyRoot = Join-Path $Root 'requirements/user-stories'
$qualityPath = Join-Path $Root 'quality/gates.json'
$qualityGateIds = @()
if (Test-Path -LiteralPath $qualityPath -PathType Leaf) {
    $qualityGateIds = @((Get-Content -LiteralPath $qualityPath -Raw | ConvertFrom-Json -Depth 30).gates.id)
}

foreach ($run in $runs) {
    $body = Get-Content -LiteralPath $run.FullName -Raw
    $frontmatter = [regex]::Match($body, '(?s)^---\s*\r?\n(?<value>.*?)\r?\n---\s*\r?\n')
    if (-not $frontmatter.Success) { throw "$($run.Name): missing YAML frontmatter." }

    $values = @{}
    foreach ($field in @('story', 'commit', 'build', 'environment', 'status')) {
        $match = [regex]::Match($frontmatter.Groups['value'].Value, "(?m)^${field}:\s*(?<value>\S.*?)\s*$")
        if (-not $match.Success) { throw "$($run.Name): missing frontmatter field '$field'." }
        $values[$field] = $match.Groups['value'].Value.Trim()
    }
    if ($values.story -notmatch '^US-\d{3,}$') { throw "$($run.Name): invalid story '$($values.story)'." }
    if ($values.commit -notmatch '^(?:[0-9a-fA-F]{7,40}|working-tree)$') { throw "$($run.Name): commit must be a Git SHA or working-tree." }
    if ($values.status -notin $allowedStatuses) { throw "$($run.Name): unsupported status '$($values.status)'." }
    foreach ($field in @('build', 'environment')) {
        if ($values[$field] -match '(待补|待定|unknown|todo|tbd)') { throw "$($run.Name): '$field' contains placeholder content." }
    }

    $storyFiles = @(Get-ChildItem -LiteralPath $storyRoot -File -Filter "$($values.story)-*.md")
    if ($storyFiles.Count -ne 1) {
        throw "$($run.Name): story '$($values.story)' must resolve to exactly one user-story file."
    }
    $storyBody = Get-Content -LiteralPath $storyFiles[0].FullName -Raw
    $storyCriteria = @([regex]::Matches($storyBody, '(?m)^### (?<id>AC-\d{3,}):') | ForEach-Object { $_.Groups['id'].Value })

    $sections = @(
        @{ Heading = '## 真实入口'; Fields = @('Command', 'Input', 'Output') },
        @{ Heading = '## 数据与副作用'; Fields = @('Before', 'After', 'Cleanup') },
        @{ Heading = '## 缺陷与回归'; Fields = @('Defects', 'Fix', 'Regression') },
        @{ Heading = '## 交接'; Fields = @('Developer self-test', 'Test handoff', 'Decision') }
    )
    foreach ($section in $sections) {
        if ($body -notmatch "(?m)^$([regex]::Escape($section.Heading))\s*$") { throw "$($run.Name): missing heading '$($section.Heading)'." }
        foreach ($field in $section.Fields) {
            $entry = [regex]::Match($body, "(?m)^- $([regex]::Escape($field)):\s*(?<value>\S.*?)\s*$")
            if (-not $entry.Success) { throw "$($run.Name): missing non-empty '$field'." }
            if ($entry.Groups['value'].Value -match '(待补|待定|unknown|todo|tbd)') { throw "$($run.Name): '$field' contains placeholder content." }
        }
    }

    $scenarioSection = [regex]::Match($body, '(?s)## 场景结果\s*(?<value>.*?)(?=^## 数据与副作用\s*$)', 'Multiline')
    if (-not $scenarioSection.Success) { throw "$($run.Name): missing heading '## 场景结果'." }
    $results = [regex]::Matches($scenarioSection.Groups['value'].Value, '(?m)^- (?<ac>AC-\d{3,}):\s*(?<status>passed|failed|blocked);\s*evidence=(?<evidence>\S.*?)\s*$')
    if ($results.Count -eq 0) { throw "$($run.Name): 场景结果必须包含 AC-nnn、状态和 evidence." }
    foreach ($result in $results) {
        $criterion = $result.Groups['ac'].Value
        if ($criterion -notin $storyCriteria) {
            throw "$($run.Name): 场景结果引用了 $($values.story) 中不存在的验收条件 '$criterion'."
        }

        $evidence = $result.Groups['evidence'].Value.Trim()
        $fileEvidence = [regex]::Match($evidence, '^file:(?<path>.+)$')
        $gateEvidence = [regex]::Match($evidence, '^gate:(?<id>[a-z0-9][a-z0-9-]*)$')
        if ($fileEvidence.Success) {
            $relative = $fileEvidence.Groups['path'].Value
            if ([IO.Path]::IsPathRooted($relative)) {
                throw "$($run.Name): evidence file must be repository-relative: '$relative'."
            }
            $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            $resolvedEvidence = [IO.Path]::GetFullPath((Join-Path $Root $relative))
            if (-not $resolvedEvidence.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or
                -not (Test-Path -LiteralPath $resolvedEvidence)) {
                throw "$($run.Name): evidence file does not exist inside the repository: '$relative'."
            }
        }
        elseif ($gateEvidence.Success) {
            if ($gateEvidence.Groups['id'].Value -notin $qualityGateIds) {
                throw "$($run.Name): evidence references unknown quality gate '$($gateEvidence.Groups['id'].Value)'."
            }
        }
        elseif ($evidence -notmatch '^(?:url:https://\S+|run:[A-Za-z0-9][A-Za-z0-9._:/-]+)$') {
            throw "$($run.Name): evidence must be file:<repo-relative-path>, gate:<gate-id>, url:https://..., or run:<system/id>."
        }
    }
    if ($values.status -eq 'passed' -and @($results | Where-Object { $_.Groups['status'].Value -ne 'passed' }).Count -gt 0) {
        throw "$($run.Name): run status is passed but at least one AC is not passed."
    }
}

Write-Output "Validated $($runs.Count) test-run records."
