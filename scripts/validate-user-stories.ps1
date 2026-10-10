[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$storyRoot = Join-Path $Root 'requirements/user-stories'
if (-not (Test-Path -LiteralPath $storyRoot)) {
    throw "Missing user-story directory: $storyRoot"
}

$stories = @(Get-ChildItem -LiteralPath $storyRoot -File -Filter 'US-*.md' |
    Where-Object { $_.Name -ne 'TEMPLATE.md' } |
    Sort-Object Name)
if ($stories.Count -eq 0) {
    throw 'At least one US-*.md user story is required.'
}

$knownStoryIds = @{}
$allowedStatuses = @('draft', 'ready', 'implemented', 'verified')
$allowedRisks = @('low', 'medium', 'high', 'critical')
$allowedTypes = @('happy', 'failure', 'boundary', 'security', 'performance', 'accessibility')

foreach ($story in $stories) {
    $body = Get-Content -LiteralPath $story.FullName -Raw
    $frontmatter = [regex]::Match($body, '(?s)^---\s*\r?\n(?<value>.*?)\r?\n---\s*\r?\n')
    if (-not $frontmatter.Success) {
        throw "$($story.Name): missing YAML frontmatter."
    }

    function Get-FrontmatterValue([string]$Name) {
        $match = [regex]::Match($frontmatter.Groups['value'].Value, "(?m)^$([regex]::Escape($Name)):\s*(?<value>\S.*?)\s*$")
        if (-not $match.Success) { throw "$($story.Name): missing frontmatter field '$Name'." }
        return $match.Groups['value'].Value.Trim()
    }

    $storyId = Get-FrontmatterValue 'id'
    $status = Get-FrontmatterValue 'status'
    $risk = Get-FrontmatterValue 'risk'
    if ($storyId -notmatch '^US-\d{3,}$') { throw "$($story.Name): invalid story id '$storyId'." }
    if ($story.BaseName -notmatch "^$([regex]::Escape($storyId))(?:-|$)") {
        throw "$($story.Name): filename must start with '$storyId-'."
    }
    if ($knownStoryIds.ContainsKey($storyId)) { throw "Duplicate user-story id: $storyId" }
    $knownStoryIds[$storyId] = $story.Name
    if ($status -notin $allowedStatuses) { throw "$($story.Name): unsupported status '$status'." }
    if ($risk -notin $allowedRisks) { throw "$($story.Name): unsupported risk '$risk'." }

    foreach ($heading in @('## 用户故事', '## 验收条件', '## 证据映射', '## 测试设计重点', '## 非目标')) {
        if ($body -notmatch "(?m)^$([regex]::Escape($heading))\s*$") {
            throw "$($story.Name): missing heading '$heading'."
        }
    }
    foreach ($field in @('Actor', 'Need', 'Value')) {
        if ($body -notmatch "(?m)^- ${field}:\s*\S") {
            throw "$($story.Name): user story requires a non-empty '$field' field."
        }
    }

    $criteriaSection = [regex]::Match($body, '(?s)## 验收条件\s*(?<value>.*?)(?=^## 证据映射\s*$)', 'Multiline')
    $criteria = [regex]::Matches(
        $criteriaSection.Groups['value'].Value,
        '(?ms)^###\s+(?<id>AC-\d{3,}):[^\r\n]*\r?\n(?<value>.*?)(?=^###\s+AC-|\z)'
    )
    if ($criteria.Count -eq 0) { throw "$($story.Name): at least one acceptance criterion is required." }

    $criterionIds = @{}
    $hasHappy = $false
    $hasNonHappy = $false
    foreach ($criterion in $criteria) {
        $criterionId = $criterion.Groups['id'].Value
        if ($criterionIds.ContainsKey($criterionId)) {
            throw "$($story.Name): duplicate acceptance criterion '$criterionId'."
        }
        $criterionIds[$criterionId] = $true
        $criterionBody = $criterion.Groups['value'].Value
        foreach ($field in @('Type', 'Given', 'When', 'Then')) {
            if ($criterionBody -notmatch "(?m)^- ${field}:\s*\S") {
                throw "$($story.Name) ${criterionId}: missing non-empty '$field'."
            }
        }
        $typeMatch = [regex]::Match($criterionBody, '(?m)^- Type:\s*(?<value>\S+)\s*$')
        $type = $typeMatch.Groups['value'].Value
        if ($type -notin $allowedTypes) {
            throw "$($story.Name) ${criterionId}: unsupported Type '$type'."
        }
        if ($type -eq 'happy') { $hasHappy = $true } else { $hasNonHappy = $true }
    }
    if (-not $hasHappy) { throw "$($story.Name): at least one happy acceptance criterion is required." }
    if ($risk -in @('high', 'critical') -and -not $hasNonHappy) {
        throw "$($story.Name): $risk-risk stories require a failure, boundary, security, performance, or accessibility criterion."
    }

    $evidenceSection = [regex]::Match($body, '(?s)## 证据映射\s*(?<value>.*?)(?=^## 测试设计重点\s*$)', 'Multiline')
    $evidenceMatches = [regex]::Matches($evidenceSection.Groups['value'].Value, '(?m)^- (?<id>AC-\d{3,}):\s*(?<value>\S.*?)\s*$')
    $evidence = @{}
    foreach ($entry in $evidenceMatches) {
        $evidence[$entry.Groups['id'].Value] = $entry.Groups['value'].Value.Trim()
    }
    foreach ($criterionId in $criterionIds.Keys) {
        if (-not $evidence.ContainsKey($criterionId)) {
            throw "$($story.Name): '$criterionId' has no evidence mapping."
        }
        if ($status -eq 'verified') {
            $mapping = $evidence[$criterionId]
            if ($mapping -match '(?i)\b(planned|todo|待补|待定)\b') {
                throw "$($story.Name): verified criterion '$criterionId' still has planned evidence."
            }
            $fileMatch = [regex]::Match($mapping, '(?:^|;)\s*file=(?<path>[^;]+)')
            if (-not $fileMatch.Success) {
                throw "$($story.Name): verified criterion '$criterionId' requires file=<evidence path>."
            }
            $evidencePath = Join-Path $Root $fileMatch.Groups['path'].Value.Trim()
            if (-not (Test-Path -LiteralPath $evidencePath)) {
                throw "$($story.Name): evidence file does not exist for '$criterionId': $evidencePath"
            }
        }
    }

    $designSection = [regex]::Match($body, '(?s)## 测试设计重点\s*(?<value>.*?)(?=^## 非目标\s*$)', 'Multiline')
    $designValues = @{}
    foreach ($field in @('主成功路径', '重要失败与恢复', '变更影响面')) {
        $entry = [regex]::Match($designSection.Groups['value'].Value, "(?m)^- $([regex]::Escape($field)):\s*(?<value>\S.*?)\s*$")
        if (-not $entry.Success) { throw "$($story.Name): 测试设计重点缺少 '$field'." }
        $designValues[$field] = $entry.Groups['value'].Value.Trim()
    }

    foreach ($field in @('主成功路径', '重要失败与恢复')) {
        $value = $designValues[$field]
        $notApplicable = [regex]::Match($value, '^(?i:N/A):\s*(?<reason>.+)$')
        if ($notApplicable.Success) {
            $reason = $notApplicable.Groups['reason'].Value.Trim()
            if ($field -eq '主成功路径' -or $risk -in @('high', 'critical')) {
                throw "$($story.Name): '$field' 对 $risk-risk Story 不能使用 N/A."
            }
            if ($reason.Length -lt 8 -or $reason -match '(待补|待定|以后|unknown|todo|tbd|不清楚)') {
                throw "$($story.Name): '$field' 的 N/A 必须给出具体、当前可审查的理由."
            }
            continue
        }
        $references = @([regex]::Matches($value, '\bAC-\d{3,}\b') | ForEach-Object Value | Select-Object -Unique)
        if ($references.Count -eq 0) { throw "$($story.Name): '$field' 必须引用 AC-nnn，或在允许时写 N/A: 具体理由." }
        foreach ($reference in $references) {
            if (-not $criterionIds.ContainsKey($reference)) {
                throw "$($story.Name): '$field' 引用了不存在的验收条件 '$reference'."
            }
        }
    }

    $impact = $designValues['变更影响面']
    if ($impact.Length -lt 12 -or $impact -match '(待补|待定|以后|unknown|todo|tbd|不清楚|正常工作|已覆盖)') {
        throw "$($story.Name): '变更影响面' 必须具体说明直接变化和需要回归的相邻表面."
    }
}

Write-Output "Validated $($stories.Count) user stories."
