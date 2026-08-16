[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$FlowPath,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($FlowPath)) { $FlowPath = Join-Path $Root '.kest/flow/governance-smoke.flow.md' }
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $Root '.kest/flow.config.yaml' }
if (-not (Test-Path -LiteralPath $FlowPath) -or -not (Test-Path -LiteralPath $ConfigPath)) { throw 'Kest Flow and flow config are required.' }
$flow = Get-Content -LiteralPath $FlowPath -Raw
$config = Get-Content -LiteralPath $ConfigPath -Raw
foreach ($required in @('strict: true', 'fail_fast: true', 'json:', 'junit:')) {
    if (-not $config.Contains($required, [StringComparison]::Ordinal)) { throw "Kest config is missing '$required'." }
}
if ($config -notmatch 'base_url:\s*"https://') { throw 'Kest base_url must use HTTPS.' }
if ($flow -match '(?i)(authorization:|api[_-]?key|bearer\s)') { throw 'Committed public Kest Flow may not contain credentials or authorization headers.' }
$stepIds = @([regex]::Matches($flow, '(?m)^@id\s+(?<id>[a-z0-9_-]+)\s*$') | ForEach-Object { $_.Groups['id'].Value })
if ($stepIds.Count -lt 2 -or @($stepIds | Sort-Object -Unique).Count -ne $stepIds.Count) { throw 'Kest Flow requires at least two unique step IDs.' }
foreach ($required in @('[Captures]', '[Asserts]', 'status == 200')) {
    if (-not $flow.Contains($required, [StringComparison]::Ordinal)) { throw "Kest Flow is missing '$required'." }
}
$edges = [regex]::Matches($flow, '(?ms)```edge\s+(?<body>.*?)```')
if ($edges.Count -eq 0) { throw 'Kest Flow requires an explicit success edge.' }
foreach ($edge in $edges) {
    foreach ($endpoint in @('from', 'to')) {
        $match = [regex]::Match($edge.Groups['body'].Value, "(?m)^@$endpoint\s+(?<id>[a-z0-9_-]+)\s*$")
        if (-not $match.Success -or $match.Groups['id'].Value -notin $stepIds) { throw "Kest edge has an unknown @$endpoint endpoint." }
    }
}
Write-Output "Validated Kest Flow contract with $($stepIds.Count) steps and $($edges.Count) edges."
