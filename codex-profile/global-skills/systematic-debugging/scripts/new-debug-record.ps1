[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Name,
    [string]$OutputDirectory = '.reports/debug'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$safeName = ($Name.ToLowerInvariant() -replace '[^a-z0-9-]+', '-').Trim('-')
$path = Join-Path $OutputDirectory "$safeName.md"
if (Test-Path -LiteralPath $path) { throw "Record already exists: $path" }

$template = @"
# Debug: $Name

- Failure signal:
- Reproduction command or steps:
- Expected result:
- Actual result:
- First divergent state:
- Failure mechanism:
- Discriminating experiment:
- Owning boundary and fix:
- Regression evidence:
- Condition varied after the fix:
- Remaining uncertainty:
"@

Set-Content -LiteralPath $path -Value $template -Encoding utf8
Write-Output $path

