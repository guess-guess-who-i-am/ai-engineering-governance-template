[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$skillsRoot = Join-Path $Root '.agents/skills'
$validator = 'D:\Codex\desktop\skills\.system\skill-creator\scripts\quick_validate.py'
$python = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$localPythonPackages = Join-Path $Root '.tools/python'
if (-not (Test-Path -LiteralPath $validator)) {
    throw "Codex skill validator not found: $validator"
}
if (-not (Test-Path -LiteralPath $python)) {
    throw "Codex bundled Python not found: $python"
}
if (-not (Test-Path -LiteralPath (Join-Path $localPythonPackages 'yaml'))) {
    throw "Missing local validator dependency. Install with: & '$python' -m pip install --target '$localPythonPackages' PyYAML"
}

$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = if ($previousPythonPath) { "$localPythonPackages;$previousPythonPath" } else { $localPythonPackages }

$skillDirs = Get-ChildItem -LiteralPath $skillsRoot -Directory | Sort-Object Name
if ($skillDirs.Count -eq 0) { throw 'No skills found.' }

foreach ($skill in $skillDirs) {
    $skillFile = Join-Path $skill.FullName 'SKILL.md'
    $metadata = Join-Path $skill.FullName 'agents/openai.yaml'
    if (-not (Test-Path -LiteralPath $skillFile)) { throw "Missing SKILL.md: $($skill.Name)" }
    if (-not (Test-Path -LiteralPath $metadata)) { throw "Missing agents/openai.yaml: $($skill.Name)" }

    & $python $validator $skill.FullName
    if ($LASTEXITCODE -ne 0) { throw "Skill validation failed: $($skill.Name)" }

    $body = Get-Content -LiteralPath $skillFile -Raw
    if ($body -notmatch '(?s)^---\s*\r?\nname:\s*' + [regex]::Escape($skill.Name)) {
        throw "Skill name does not match directory: $($skill.Name)"
    }

    $yaml = Get-Content -LiteralPath $metadata -Raw
    if ($yaml -notmatch [regex]::Escape('$' + $skill.Name)) {
        throw "default_prompt does not mention `$$($skill.Name): $($skill.Name)"
    }
}

$env:PYTHONPATH = $previousPythonPath
Write-Output "Validated $($skillDirs.Count) skills."
