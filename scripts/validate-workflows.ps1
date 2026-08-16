[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$workflowRoot = Join-Path $Root '.github/workflows'
$workflows = @(Get-ChildItem -LiteralPath $workflowRoot -File | Where-Object { $_.Extension -in @('.yml', '.yaml') })
if ($workflows.Count -eq 0) { throw 'At least one GitHub Actions workflow is required.' }

foreach ($workflow in $workflows) {
    $body = Get-Content -LiteralPath $workflow.FullName -Raw
    if ($body -match '(?m)^\s*pull_request_target\s*:') {
        throw "$($workflow.Name): pull_request_target is forbidden for repository code verification."
    }
    if ($body -notmatch '(?m)^permissions:\s*\r?\n(?:\s+[^\r\n]+\r?\n)*?\s+contents:\s*read\s*$') {
        throw "$($workflow.Name): declare top-level least-privilege permissions with contents: read."
    }
    $writePermissions = @([regex]::Matches($body, '(?m)^\s+(?<permission>[a-z-]+):\s*write\s*$'))
    foreach ($writePermission in $writePermissions) {
        $isGuardedIssueSync = $workflow.Name -eq 'findings.yml' -and
            $writePermission.Groups['permission'].Value -eq 'issues' -and
            $body -match '(?m)^\s{2}workflow_dispatch:\s*$' -and
            $body -notmatch '(?m)^\s{2}(pull_request|push):'
        $isGuardedPagesDeploy = $workflow.Name -eq 'pages.yml' -and
            $writePermission.Groups['permission'].Value -in @('pages', 'id-token') -and
            $body -notmatch '(?m)^\s{2}pull_request:' -and
            $body.Contains('actions/deploy-pages@', [StringComparison]::Ordinal)
        $isGuardedRelease = $workflow.Name -eq 'release.yml' -and
            $writePermission.Groups['permission'].Value -eq 'contents' -and
            $body -match "(?m)^\s{4}tags:\s*\['v\*\.\*\.\*'\]\s*$" -and
            $body -notmatch '(?m)^\s{2}pull_request:' -and
            $body.Contains('gh release create', [StringComparison]::Ordinal)
        if (-not ($isGuardedIssueSync -or $isGuardedPagesDeploy -or $isGuardedRelease)) {
            throw "$($workflow.Name): validation workflows may not request '$($writePermission.Groups['permission'].Value): write'."
        }
    }

    $lines = Get-Content -LiteralPath $workflow.FullName
    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        $uses = [regex]::Match($line, '^\s*-?\s*uses:\s*(?<owner>[^/\s]+)/(?<repo>[^@\s]+)@(?<ref>[^\s#]+)(?<comment>.*)$')
        if (-not $uses.Success) { continue }
        if ($uses.Groups['ref'].Value -notmatch '^[0-9a-f]{40}$') {
            throw "$($workflow.Name):$($index + 1): external action must be pinned to a full commit SHA."
        }
        if ($uses.Groups['comment'].Value -notmatch '#\s*v?\d') {
            throw "$($workflow.Name):$($index + 1): pinned action requires an adjacent reviewed version comment."
        }
        if ($uses.Groups['owner'].Value -eq 'actions' -and $uses.Groups['repo'].Value -eq 'checkout') {
            $windowEnd = [math]::Min($index + 6, $lines.Count - 1)
            $window = ($lines[$index..$windowEnd] -join "`n")
            if ($window -notmatch '(?m)^\s+persist-credentials:\s*false\s*$') {
                throw "$($workflow.Name): checkout must set persist-credentials: false."
            }
        }
    }

    if ($workflow.Name -eq 'qualitative-gate.yml') {
        foreach ($requiredText in @(
            'workflow_dispatch:',
            "vars.LLM_GATE_ENABLED == 'true'",
            'secrets.LLM_API_KEY',
            'secrets.LLM_BASE_URL'
        )) {
            if (-not $body.Contains($requiredText, [StringComparison]::Ordinal)) {
                throw "$($workflow.Name): missing guarded qualitative-gate wiring '$requiredText'."
            }
        }
    }
    if ($workflow.Name -eq 'findings.yml') {
        foreach ($requiredText in @('workflow_dispatch:', 'issues: write', 'inputs.create_issues', 'sync-findings-to-github.ps1 -Apply')) {
            if (-not $body.Contains($requiredText, [StringComparison]::Ordinal)) {
                throw "$($workflow.Name): missing guarded findings wiring '$requiredText'."
            }
        }
    }
    if ($workflow.Name -eq 'pages.yml') {
        foreach ($requiredText in @('actions/configure-pages@', 'actions/upload-pages-artifact@', 'actions/deploy-pages@', 'Smoke deployed site')) {
            if (-not $body.Contains($requiredText, [StringComparison]::Ordinal)) { throw "$($workflow.Name): missing Pages evidence '$requiredText'." }
        }
    }
    if ($workflow.Name -eq 'release.yml') {
        foreach ($requiredText in @("tags: ['v*.*.*']", 'validate-release.ps1', 'invoke-quality-gates.ps1 -Profile release', 'gh release create')) {
            if (-not $body.Contains($requiredText, [StringComparison]::Ordinal)) { throw "$($workflow.Name): missing release evidence '$requiredText'." }
        }
    }
}

Write-Output "Validated $($workflows.Count) GitHub Actions workflows."
