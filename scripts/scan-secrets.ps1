[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$patterns = @(
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'sk-[A-Za-z0-9_-]{20,}',
    'AKIA[0-9A-Z]{16}',
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
)

$gitRoot = Join-Path $Root '.git'
if (Test-Path -LiteralPath $gitRoot) {
    $relativeFiles = @(git -C $Root ls-files --cached --others --exclude-standard)
    $files = $relativeFiles |
        Where-Object { $_ -and $_ -notmatch '^(upstreams|\.reports|\.tools|\.kest/logs|\.kest/reports)/' } |
        ForEach-Object { Get-Item -LiteralPath (Join-Path $Root $_) -Force -ErrorAction SilentlyContinue } |
        Where-Object { $_ -and $_.Name -notmatch '\.(png|jpg|jpeg|gif|webp|ico|zip|gz|exe|dll)$' }
}
else {
    $files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
        Where-Object {
            $_.FullName -notmatch '[\\/](\.git|upstreams|\.reports|\.tools)[\\/]' -and
            $_.Name -notmatch '\.(png|jpg|jpeg|gif|webp|ico|zip|gz|exe|dll)$'
        }
}

$findings = foreach ($file in $files) {
    foreach ($pattern in $patterns) {
        Select-String -LiteralPath $file.FullName -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
    }
}

if ($findings) {
    $locations = $findings | ForEach-Object { "$($_.Path):$($_.LineNumber)" } | Sort-Object -Unique
    throw "Potential secret material found: $($locations -join ', ')"
}

Write-Output 'Secret scan passed.'
