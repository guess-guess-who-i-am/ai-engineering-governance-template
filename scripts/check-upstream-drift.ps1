[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$LockPath,
    [string]$OutputPath,
    [switch]$FailOnDrift
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($LockPath)) { $LockPath = Join-Path $Root 'upstreams.lock.json' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $Root '.reports/upstream-drift.json' }
& (Join-Path $Root 'scripts/validate-upstream-lock.ps1') -Path $LockPath | Out-Null
$lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json -Depth 10
$results = foreach ($source in $lock.sources) {
    $line = & git ls-remote $source.url "refs/heads/$($source.branch)" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        [pscustomobject]@{ name = $source.name; status = 'unavailable'; pinned_commit = $source.commit; remote_commit = $null; error = $line.Trim() }
        continue
    }
    $remoteCommit = (($line.Trim() -split "`t")[0]).Trim()
    if ($remoteCommit -notmatch '^[0-9a-f]{40}$') {
        [pscustomobject]@{ name = $source.name; status = 'unavailable'; pinned_commit = $source.commit; remote_commit = $null; error = 'Remote branch did not resolve to a full Git SHA.' }
        continue
    }
    [pscustomobject]@{
        name = $source.name
        status = if ($remoteCommit -eq $source.commit) { 'current' } else { 'drifted' }
        pinned_commit = $source.commit
        remote_commit = $remoteCommit
        compare_url = if ($source.url -match '^https://github\.com/') { ($source.url -replace '\.git$', '') + "/compare/$($source.commit)...$remoteCommit" } else { $null }
    }
}
$report = [pscustomobject]@{
    schema = 'upstream-drift-report/v1'
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    status = if (@($results | Where-Object status -ne 'current').Count) { 'attention-required' } else { 'current' }
    sources = @($results)
}
$directory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$attention = @($results | Where-Object status -ne 'current')
if ($FailOnDrift -and $attention.Count) { throw "Upstream attention required: $(($attention | ForEach-Object { "$($_.name)=$($_.status)" }) -join ', ')" }
Write-Output "Checked $(@($results).Count) upstreams; $($attention.Count) require attention."
