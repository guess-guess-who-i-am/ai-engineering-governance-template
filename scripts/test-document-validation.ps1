[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $Root 'scripts/validate-documents.ps1'
$tempBase = [IO.Path]::GetTempPath()
$fixture = Join-Path $tempBase ("document-validation-" + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'docs') -Force | Out-Null
    git -C $fixture init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize document-validation fixture.' }

    Set-Content -LiteralPath (Join-Path $fixture 'README.md') -Value "# Fixture`n" -Encoding utf8
    git -C $fixture add README.md
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the fixture README.' }

    Set-Content -LiteralPath (Join-Path $fixture 'docs/good.json') -Value '{"status":"ok"}' -Encoding utf8
    $success = & $validator -Root $fixture 2>&1
    if ($LASTEXITCODE -ne 0 -or ($success -join "`n") -notmatch '2 repository text files') {
        throw "The validator did not include a valid governed untracked file: $($success -join ' ')"
    }

    Set-Content -LiteralPath (Join-Path $fixture 'docs/bad.json') -Value '{invalid' -Encoding utf8
    $rejected = $false
    $failure = ''
    try {
        & $validator -Root $fixture 2>&1 | Out-Null
    }
    catch {
        $rejected = $true
        $failure = $_ | Out-String
    }
    if (-not $rejected -or $failure -notmatch 'Invalid JSON: docs/bad.json') {
        throw "The validator did not reject an invalid governed untracked JSON file: $failure"
    }

    Write-Output 'Document validation tracked/untracked contract passed.'
}
finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempPrefix = [IO.Path]::GetFullPath($tempBase).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolved).StartsWith('document-validation-', [StringComparison]::Ordinal) -and
        (Test-Path -LiteralPath $resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
