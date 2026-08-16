[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $Root '.reports/release-notes.md' }
& (Join-Path $Root 'scripts/validate-release.ps1') -Root $Root | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $Root 'VERSION') -Raw).Trim()
$changelog = Get-Content -LiteralPath (Join-Path $Root 'CHANGELOG.md') -Raw
$match = [regex]::Match($changelog, "(?ms)^## $([regex]::Escape($version)) - [^\r\n]+\r?\n(?<body>.*?)(?=^## |\z)")
if (-not $match.Success) { throw "Could not extract release notes for $version." }
$directory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
"# AI Engineering Governance Template v$version`n`n$($match.Groups['body'].Value.Trim())`n" | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Wrote release notes to $OutputPath."
