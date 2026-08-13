[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$repos = [ordered]@{
    'awesome-design-md' = 'https://github.com/VoltAgent/awesome-design-md.git'
    'taste-skill'       = 'https://github.com/Leonxlnx/taste-skill.git'
    'emil-skills'       = 'https://github.com/emilkowalski/skills.git'
    'kest'              = 'https://github.com/kest-labs/kest.git'
    'luas'              = 'https://github.com/agicto/luas.git'
}

$upstreamRoot = Join-Path $Root 'upstreams'
$reportRoot = Join-Path $Root '.reports'
New-Item -ItemType Directory -Force -Path $upstreamRoot, $reportRoot | Out-Null

$results = foreach ($entry in $repos.GetEnumerator()) {
    $target = Join-Path $upstreamRoot $entry.Key
    if (Test-Path -LiteralPath (Join-Path $target '.git')) {
        git -C $target fetch --all --tags --prune
        git -C $target pull --ff-only
    }
    else {
        git clone --filter=blob:none $entry.Value $target
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to update $($entry.Key)"
    }

    [ordered]@{
        name = $entry.Key
        url = $entry.Value
        commit = (git -C $target rev-parse HEAD).Trim()
        branch = (git -C $target branch --show-current).Trim()
        updated_at = (Get-Date).ToString('o')
    }
}

$reportPath = Join-Path $reportRoot 'upstreams.json'
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Output "Updated $($results.Count) upstream repositories."
Write-Output "Version report: $reportPath"

