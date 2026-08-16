[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath (Join-Path $Root 'VERSION') -Raw).Trim()
if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "VERSION is not semantic: '$version'." }
$package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne $version) { throw "package.json version '$($package.version)' does not match VERSION '$version'." }
$changelog = Get-Content -LiteralPath (Join-Path $Root 'CHANGELOG.md') -Raw
if ($changelog -notmatch "(?m)^## $([regex]::Escape($version)) - [0-9]{4}-[0-9]{2}-[0-9]{2}$") { throw "CHANGELOG.md has no dated section for $version." }
if (-not [string]::IsNullOrWhiteSpace($Tag) -and $Tag -ne "v$version") { throw "Tag '$Tag' does not match v$version." }
Write-Output "Release metadata is consistent for v$version."
