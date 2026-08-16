[CmdletBinding()]
param(
    [ValidateSet('pr', 'release', 'nightly', 'qualitative', 'performance')]
    [string]$Profile = 'pr',
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($Root)
& (Join-Path $resolvedRoot 'scripts/validate-quality-gates.ps1') -Root $resolvedRoot
$config = Get-Content -LiteralPath (Join-Path $resolvedRoot 'quality/gates.json') -Raw | ConvertFrom-Json -Depth 20
$results = [System.Collections.Generic.List[object]]::new()

function Write-QualityReport {
    param(
        [string]$Status,
        [object[]]$Blockers = @()
    )

    $reportRoot = Join-Path $resolvedRoot '.reports/quality'
    New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
    [pscustomobject]@{
        schema = 'quality-gate-report/v1'
        profile = $Profile
        status = $Status
        project_kind = $config.projectKind
        generated_at = (Get-Date).ToUniversalTime().ToString('o')
        blockers = $Blockers
        results = @($results)
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportRoot "$Profile.json") -Encoding utf8
}

if ($Profile -eq 'release') {
    $blockers = @($config.gates | Where-Object { $_.state -eq 'planned' -and $_.requiredBeforeRelease -eq $true })
    if ($blockers.Count -gt 0) {
        $details = $blockers | ForEach-Object { "$($_.id) [$($_.category)]" }
        Write-QualityReport -Status 'blocked' -Blockers @($details)
        throw "Release is blocked by unconfigured required gates: $($details -join ', ')"
    }
}

$selected = @($config.gates | Where-Object { $_.state -eq 'active' -and $Profile -in $_.profiles })
if ($selected.Count -eq 0) {
    Write-QualityReport -Status 'not-configured'
    throw "No active quality gates are configured for profile '$Profile'."
}

$profileStatus = 'passed'
try {
    foreach ($gate in $selected) {
        $relativeWorkingDirectory = if ([string]::IsNullOrWhiteSpace($gate.workingDirectory)) { '.' } else { $gate.workingDirectory }
        $workingDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $relativeWorkingDirectory))
        $rootPrefix = $resolvedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if ($workingDirectory -ne $resolvedRoot -and -not $workingDirectory.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$($gate.id): workingDirectory escapes the repository root."
        }
        if (-not (Test-Path -LiteralPath $workingDirectory -PathType Container)) {
            throw "$($gate.id): workingDirectory does not exist: $workingDirectory"
        }

        $started = Get-Date
        Write-Output "[$Profile] Running $($gate.id) ($($gate.category))"
        Push-Location $workingDirectory
        try {
            $arguments = @($gate.command.arguments)
            & $gate.command.executable @arguments
            $exitCode = $LASTEXITCODE
            if ($null -eq $exitCode) { $exitCode = 0 }
            if ($exitCode -ne 0) { throw "$($gate.id) failed with exit code $exitCode." }
        }
        catch {
            $results.Add([pscustomobject]@{
                id = $gate.id
                category = $gate.category
                status = 'failed'
                duration_ms = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
                error = $_.Exception.Message
            })
            throw
        }
        finally {
            Pop-Location
        }
        $results.Add([pscustomobject]@{
            id = $gate.id
            category = $gate.category
            status = 'passed'
            duration_ms = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
        })
    }
}
catch {
    $profileStatus = 'failed'
    throw
}
finally {
    Write-QualityReport -Status $profileStatus
}

Write-Output "Quality profile '$Profile' passed $($results.Count) active gates."
