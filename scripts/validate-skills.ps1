[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$skillsRoot = Join-Path $Root '.agents/skills'
$validator = Join-Path $Root 'scripts/validate-skill.ps1'
if (-not (Test-Path -LiteralPath $validator)) { throw "Missing validator: $validator" }

$skillDirs = Get-ChildItem -LiteralPath $skillsRoot -Directory | Sort-Object Name
if ($skillDirs.Count -eq 0) { throw 'No skills found.' }

foreach ($skill in $skillDirs) {
    $skillFile = Join-Path $skill.FullName 'SKILL.md'
    $metadata = Join-Path $skill.FullName 'agents/openai.yaml'
    if (-not (Test-Path -LiteralPath $skillFile)) { throw "Missing SKILL.md: $($skill.Name)" }
    if (-not (Test-Path -LiteralPath $metadata)) { throw "Missing agents/openai.yaml: $($skill.Name)" }

    & $validator -SkillPath $skill.FullName

    $body = Get-Content -LiteralPath $skillFile -Raw
    if ($body -notmatch '(?s)^---\s*\r?\nname:\s*' + [regex]::Escape($skill.Name)) {
        throw "Skill name does not match directory: $($skill.Name)"
    }

    $yaml = Get-Content -LiteralPath $metadata -Raw
    if ($yaml -notmatch [regex]::Escape('$' + $skill.Name)) {
        throw "default_prompt does not mention `$$($skill.Name): $($skill.Name)"
    }
}

Write-Output "Validated $($skillDirs.Count) skills."
