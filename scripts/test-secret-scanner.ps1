[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('secret-scanner-' + [guid]::NewGuid())
$pwsh = (Get-Process -Id $PID).Path
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $sample = Join-Path $temporary 'sample.md'
    Set-Content -LiteralPath $sample -Value 'task-tree-execution-policy-routing and risk-assessment-security-review'
    & $pwsh -NoProfile -File (Join-Path $Root 'scripts/scan-secrets.ps1') -Root $temporary 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Skill names were mistaken for credentials.' }
    foreach ($token in @(('sk-' + ('A' * 24)), ('ghp_' + ('B' * 24)), ('AKIA' + ('C' * 16)))) {
        Set-Content -LiteralPath $sample -Value ('credential="' + $token + '"')
        & $pwsh -NoProfile -File (Join-Path $Root 'scripts/scan-secrets.ps1') -Root $temporary 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { throw 'Credential-shaped fixture was not detected.' }
    }
    Write-Output 'Secret scanner rejects credential-shaped fixtures and permits Skill names.'
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
