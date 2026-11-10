[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$skillsRoot = Join-Path $Root '.agents/skills'
$validator = Join-Path $Root 'scripts/validate-skill.ps1'
if (-not (Test-Path -LiteralPath $validator)) { throw "Missing validator: $validator" }

function Read-StrictUtf8 {
    param([Parameter(Mandatory)] [string]$Path)
    $decoder = [Text.UTF8Encoding]::new($false, $true)
    try {
        $text = $decoder.GetString([IO.File]::ReadAllBytes($Path))
    }
    catch {
        throw "File is not valid UTF-8: $Path"
    }
    $mojibakeMarkers = @(
        (-join @([char]0x951F, [char]0x65A4, [char]0x62F7)),
        (-join @([char]0x00EF, [char]0x00BF, [char]0x00BD))
    )
    if ($text.Contains([char]0xFFFD) -or @($mojibakeMarkers | Where-Object { $text.Contains($_) }).Count -gt 0) {
        throw "File contains replacement or mojibake markers: $Path"
    }
    return $text
}

function Get-QuotedYamlValue {
    param(
        [Parameter(Mandatory)] [string]$Yaml,
        [Parameter(Mandatory)] [string]$Key,
        [Parameter(Mandatory)] [string]$Path
    )
    $pattern = '(?m)^\s{2}' + [regex]::Escape($Key) + ':\s*"(?<value>[^\"]*)"\s*$'
    $matches = [regex]::Matches($Yaml, $pattern)
    if ($matches.Count -ne 1) { throw "${Path}: interface.$Key must appear exactly once as a quoted string." }
    return $matches[0].Groups['value'].Value
}

$skillDirs = @(Get-ChildItem -LiteralPath $skillsRoot -Directory | Sort-Object Name)
if ($skillDirs.Count -eq 0) { throw 'No skills found.' }
$displayNames = @{}

foreach ($skill in $skillDirs) {
    $skillFile = Join-Path $skill.FullName 'SKILL.md'
    $metadata = Join-Path $skill.FullName 'agents/openai.yaml'
    if (-not (Test-Path -LiteralPath $skillFile)) { throw "Missing SKILL.md: $($skill.Name)" }
    if (-not (Test-Path -LiteralPath $metadata)) { throw "Missing agents/openai.yaml: $($skill.Name)" }

    & $validator -SkillPath $skill.FullName

    $body = Read-StrictUtf8 -Path $skillFile
    if ($body -notmatch '(?s)^---\s*\r?\nname:\s*' + [regex]::Escape($skill.Name)) {
        throw "Skill name does not match directory: $($skill.Name)"
    }

    $yaml = Read-StrictUtf8 -Path $metadata
    if ($yaml -notmatch '(?m)^interface:\s*$') { throw "${metadata}: missing interface mapping." }
    $displayName = Get-QuotedYamlValue -Yaml $yaml -Key 'display_name' -Path $metadata
    $shortDescription = Get-QuotedYamlValue -Yaml $yaml -Key 'short_description' -Path $metadata
    $defaultPrompt = Get-QuotedYamlValue -Yaml $yaml -Key 'default_prompt' -Path $metadata

    foreach ($field in @{
        display_name = $displayName
        short_description = $shortDescription
        default_prompt = $defaultPrompt
    }.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace($field.Value)) { throw "${metadata}: interface.$($field.Key) cannot be empty." }
        if ($field.Value -notmatch '[\p{IsCJKUnifiedIdeographs}]') {
            throw "${metadata}: interface.$($field.Key) must contain a Chinese user-facing explanation."
        }
    }
    if ($shortDescription.Length -lt 25 -or $shortDescription.Length -gt 64) {
        throw "${metadata}: interface.short_description must be 25-64 characters; got $($shortDescription.Length)."
    }
    if ($displayNames.ContainsKey($displayName)) {
        throw "${metadata}: duplicate interface.display_name '$displayName' also used by $($displayNames[$displayName])."
    }
    $displayNames[$displayName] = $skill.Name

    $expectedReference = '$' + $skill.Name
    $references = @([regex]::Matches($defaultPrompt, '\$[a-z0-9]+(?:-[a-z0-9]+)*') | ForEach-Object Value)
    if ($references.Count -ne 1 -or $references[0] -cne $expectedReference) {
        throw "${metadata}: interface.default_prompt must reference exactly $expectedReference."
    }
}

Write-Output "Validated $($skillDirs.Count) skills."
