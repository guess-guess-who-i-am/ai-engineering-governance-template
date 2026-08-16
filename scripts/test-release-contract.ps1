[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$validator = Join-Path $Root 'scripts/validate-release.ps1'
& $validator -Root $Root | Out-Null
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("release-contract-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root 'VERSION'), (Join-Path $Root 'package.json'), (Join-Path $Root 'CHANGELOG.md') -Destination $fixtureRoot
    $changelogPath = Join-Path $fixtureRoot 'CHANGELOG.md'
    $crlfChangelog = (Get-Content -LiteralPath $changelogPath -Raw) -replace "\r?\n", "`r`n"
    [IO.File]::WriteAllText($changelogPath, $crlfChangelog, [Text.UTF8Encoding]::new($false))
    & $validator -Root $fixtureRoot | Out-Null
    try {
        & $validator -Root $fixtureRoot -Tag 'v9.9.9' 2>&1 | Out-Null
        throw 'Expected a mismatched tag to fail.'
    }
    catch { if (($_ | Out-String) -notmatch 'does not match') { throw } }
    $packagePath = Join-Path $fixtureRoot 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $package.version = '0.0.1'
    $package | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $packagePath -Encoding utf8
    try {
        & $validator -Root $fixtureRoot 2>&1 | Out-Null
        throw 'Expected mismatched package metadata to fail.'
    }
    catch { if (($_ | Out-String) -notmatch 'does not match VERSION') { throw } }
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
Write-Output 'Release metadata LF/CRLF success, mismatched tag, and mismatched package cases passed.'
