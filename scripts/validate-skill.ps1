[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$SkillPath
)

$ErrorActionPreference = 'Stop'
$skillFile = Join-Path $SkillPath 'SKILL.md'
if (-not (Test-Path -LiteralPath $skillFile)) { throw "SKILL.md not found: $SkillPath" }

$content = (Get-Content -LiteralPath $skillFile -Raw) -replace "`r`n", "`n"
$match = [regex]::Match($content, '^---\n(?<frontmatter>.*?)\n---(?:\n|$)', 'Singleline')
if (-not $match.Success) { throw "Invalid YAML frontmatter: $skillFile" }

$frontmatter = $match.Groups['frontmatter'].Value
$properties = [ordered]@{}
foreach ($line in ($frontmatter -split "`n")) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $property = [regex]::Match($line, '^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$')
    if (-not $property.Success) {
        throw "Unsupported or malformed frontmatter line in ${skillFile}: $line"
    }
    $key = $property.Groups['key'].Value
    $value = $property.Groups['value'].Value.Trim().Trim('"').Trim("'")
    if ($properties.Contains($key)) { throw "Duplicate frontmatter key '$key': $skillFile" }
    $properties[$key] = $value
}

$allowed = @('name', 'description', 'license', 'allowed-tools', 'metadata')
$unexpected = @($properties.Keys | Where-Object { $_ -notin $allowed })
if ($unexpected.Count -gt 0) { throw "Unexpected frontmatter keys in ${skillFile}: $($unexpected -join ', ')" }
if (-not $properties.Contains('name')) { throw "Missing name: $skillFile" }
if (-not $properties.Contains('description')) { throw "Missing description: $skillFile" }

$name = $properties['name']
if ($name -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "Invalid skill name '$name': $skillFile" }
if ($name.Length -gt 64) { throw "Skill name exceeds 64 characters: $skillFile" }

$description = $properties['description']
if ([string]::IsNullOrWhiteSpace($description)) { throw "Empty description: $skillFile" }
if ($description.Length -gt 1024) { throw "Description exceeds 1024 characters: $skillFile" }
if ($description.Contains('<') -or $description.Contains('>')) { throw "Description contains angle brackets: $skillFile" }

$folderName = Split-Path -Leaf (Resolve-Path -LiteralPath $SkillPath)
if ($name -ne $folderName) { throw "Skill name '$name' does not match folder '$folderName'" }

Write-Output "Skill is valid: $name"
