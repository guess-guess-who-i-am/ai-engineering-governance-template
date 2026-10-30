[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('secret-boundary-' + [guid]::NewGuid().ToString('N'))
$scanner = Join-Path $PSScriptRoot 'scan-secrets.ps1'
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $fixture = Join-Path $temporary 'fixture.txt'
    Set-Content -LiteralPath $fixture -Value 'task-content-recommendation-integration task-content-runtime-benchmark' -Encoding utf8
    & $scanner -Root $temporary
    foreach ($prefix in @('', 'key=', 'Bearer ', '"')) {
        $synthetic = ('s' + 'k-') + ('a' * 32)
        Set-Content -LiteralPath $fixture -Value ($prefix + $synthetic) -Encoding utf8
        $detected = $false
        try { & $scanner -Root $temporary } catch {
            if ($_.Exception.Message -notmatch 'Potential secret material found') { throw }
            $detected = $true
        }
        if (-not $detected) { throw 'Scanner failed to detect a standalone synthetic token.' }
    }
    Write-Output 'Secret scanner boundary passed: task filenames allowed; four synthetic token contexts rejected.'
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
