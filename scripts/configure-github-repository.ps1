[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Repository,
    [string]$RequiredCheck = 'validate',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Invoke-Gh {
    param(
        [string[]]$Arguments,
        [object]$InputObject,
        [switch]$AllowEmpty
    )

    if ($PSBoundParameters.ContainsKey('InputObject')) {
        $output = $InputObject | ConvertTo-Json -Depth 20 | & gh @Arguments 2>&1
    }
    else {
        $output = & gh @Arguments 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($Arguments -join ' ') failed:`n$($output -join "`n")"
    }
    $text = ($output -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        if ($AllowEmpty) { return $null }
        throw "gh $($Arguments -join ' ') returned no JSON."
    }
    return $text | ConvertFrom-Json -Depth 30
}

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated.'
}

if ([string]::IsNullOrWhiteSpace($Repository)) {
    $view = Invoke-Gh -Arguments @('repo', 'view', '--json', 'nameWithOwner')
    $Repository = $view.nameWithOwner
}
if ($Repository -notmatch '^[^/\s]+/[^/\s]+$') {
    throw "Repository must use owner/name form, received '$Repository'."
}

$repo = Invoke-Gh -Arguments @('api', "repos/$Repository")
$defaultBranch = [string]$repo.default_branch
if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
    throw "$Repository has no default branch."
}

if ($Apply -and $PSCmdlet.ShouldProcess($Repository, 'Apply repository security and protected-branch policy')) {
    Invoke-Gh -Arguments @('api', '--method', 'PUT', "repos/$Repository/vulnerability-alerts") -AllowEmpty | Out-Null

    $repositoryPolicy = @{
        allow_auto_merge = $true
        delete_branch_on_merge = $true
        security_and_analysis = @{
            dependabot_security_updates = @{ status = 'enabled' }
            secret_scanning = @{ status = 'enabled' }
            secret_scanning_push_protection = @{ status = 'enabled' }
        }
    }
    Invoke-Gh -Arguments @('api', '--method', 'PATCH', "repos/$Repository", '--input', '-') -InputObject $repositoryPolicy | Out-Null
    Invoke-Gh -Arguments @('api', '--method', 'PUT', "repos/$Repository/private-vulnerability-reporting") -AllowEmpty | Out-Null

    $protectionPolicy = @{
        required_status_checks = @{
            strict = $true
            contexts = @($RequiredCheck)
        }
        enforce_admins = $true
        required_pull_request_reviews = @{
            dismiss_stale_reviews = $true
            require_code_owner_reviews = $false
            required_approving_review_count = 0
            require_last_push_approval = $false
        }
        restrictions = $null
        required_linear_history = $true
        allow_force_pushes = $false
        allow_deletions = $false
        block_creations = $false
        required_conversation_resolution = $true
        lock_branch = $false
        allow_fork_syncing = $true
    }
    Invoke-Gh -Arguments @('api', '--method', 'PUT', "repos/$Repository/branches/$defaultBranch/protection", '--input', '-') -InputObject $protectionPolicy | Out-Null

    & gh variable set LLM_GATE_ENABLED --repo $Repository --body false
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not initialize the LLM_GATE_ENABLED repository variable.'
    }
}

$repo = Invoke-Gh -Arguments @('api', "repos/$Repository")
$protection = Invoke-Gh -Arguments @('api', "repos/$Repository/branches/$defaultBranch/protection")
$privateReporting = Invoke-Gh -Arguments @('api', "repos/$Repository/private-vulnerability-reporting")
$llmVariable = Invoke-Gh -Arguments @('api', "repos/$Repository/actions/variables/LLM_GATE_ENABLED")

$failures = [System.Collections.Generic.List[string]]::new()
if ($repo.visibility -ne 'public') { $failures.Add('repository visibility is not public') }
if ($repo.security_and_analysis.secret_scanning.status -ne 'enabled') { $failures.Add('secret scanning is not enabled') }
if ($repo.security_and_analysis.secret_scanning_push_protection.status -ne 'enabled') { $failures.Add('secret scanning push protection is not enabled') }
if ($repo.security_and_analysis.dependabot_security_updates.status -ne 'enabled') { $failures.Add('Dependabot security updates are not enabled') }
if ($repo.allow_auto_merge -ne $true) { $failures.Add('auto-merge is not enabled') }
if ($repo.delete_branch_on_merge -ne $true) { $failures.Add('merged branches are not deleted automatically') }
if ($privateReporting.enabled -ne $true) { $failures.Add('private vulnerability reporting is not enabled') }
if ($protection.required_status_checks.strict -ne $true) { $failures.Add('required status checks are not strict') }
if ($RequiredCheck -notin @($protection.required_status_checks.contexts)) { $failures.Add("required check '$RequiredCheck' is missing") }
if ($protection.enforce_admins.enabled -ne $true) { $failures.Add('branch protection does not include administrators') }
if ($null -eq $protection.required_pull_request_reviews) { $failures.Add('pull requests are not required') }
if ($protection.required_linear_history.enabled -ne $true) { $failures.Add('linear history is not required') }
if ($protection.required_conversation_resolution.enabled -ne $true) { $failures.Add('conversation resolution is not required') }
if ($protection.allow_force_pushes.enabled -eq $true) { $failures.Add('force pushes are allowed') }
if ($protection.allow_deletions.enabled -eq $true) { $failures.Add('protected branch deletion is allowed') }
if ($llmVariable.value -notin @('true', 'false')) { $failures.Add('LLM_GATE_ENABLED is not explicitly configured') }

if ($failures.Count -gt 0) {
    throw "GitHub repository policy audit failed:`n- $($failures -join "`n- ")"
}

[pscustomobject]@{
    Repository = $Repository
    Visibility = $repo.visibility
    DefaultBranch = $defaultBranch
    RequiredCheck = $RequiredCheck
    PullRequestRequired = $true
    ForcePushAllowed = $false
    SecretScanning = $repo.security_and_analysis.secret_scanning.status
    PushProtection = $repo.security_and_analysis.secret_scanning_push_protection.status
    DependabotSecurityUpdates = $repo.security_and_analysis.dependabot_security_updates.status
    PrivateVulnerabilityReporting = $privateReporting.enabled
    LlmGateEnabled = $llmVariable.value
}
