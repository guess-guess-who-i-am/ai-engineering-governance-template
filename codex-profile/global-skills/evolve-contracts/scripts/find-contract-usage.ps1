[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Pattern,
    [string]$Root = '.'
)

$ErrorActionPreference = 'Stop'
if (Get-Command rg -ErrorAction SilentlyContinue) {
    rg --hidden --glob '!upstreams/**' --glob '!.git/**' --line-number --fixed-strings -- $Pattern $Root
    exit $LASTEXITCODE
}

Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch '[\\/](\.git|upstreams)[\\/]' } |
    Select-String -SimpleMatch -Pattern $Pattern

