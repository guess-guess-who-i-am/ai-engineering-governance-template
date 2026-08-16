[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($Root)
$manifest = Get-Content -LiteralPath (Join-Path $resolvedRoot 'qualitative/manifest.json') -Raw | ConvertFrom-Json
$expectedRequests = @($manifest.cases).Count
$reportDirectory = '.reports/qualitative-contract'

$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = ([Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$baseUrl = "http://127.0.0.1:$port"
$prefix = "$baseUrl/"

$server = Start-Job -ScriptBlock {
    param([string]$Prefix, [int]$ExpectedRequests)

    $ErrorActionPreference = 'Stop'
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add($Prefix)
    $listener.Start()
    Write-Output '__READY__'

    try {
        for ($requestIndex = 0; $requestIndex -lt $ExpectedRequests; $requestIndex++) {
            $context = $listener.GetContext()
            $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
            try {
                $requestText = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }

            if ($context.Request.HttpMethod -ne 'POST' -or $context.Request.Url.AbsolutePath -ne '/responses') {
                throw "Unexpected request target: $($context.Request.HttpMethod) $($context.Request.Url.AbsolutePath)"
            }
            if ($context.Request.Headers['Authorization'] -ne 'Bearer qualitative-contract-test-key') {
                throw 'The qualitative adapter did not send the expected bearer credential.'
            }

            $request = $requestText | ConvertFrom-Json -Depth 30
            if ($request.PSObject.Properties.Name -contains 'model') {
                throw 'A blank model must be omitted so the configured gateway can choose its default.'
            }
            if (@($request.input).Count -ne 2 -or $request.input[0].role -ne 'system' -or $request.input[1].role -ne 'user') {
                throw 'The qualitative adapter did not send the expected system and user messages.'
            }
            if ($request.text.format.type -ne 'json_schema' -or $request.text.format.strict -ne $true) {
                throw 'The qualitative adapter did not request strict JSON Schema output.'
            }

            $caseMatch = [regex]::Match([string]$request.input[1].content, '(?m)^CASE_ID:\s*(?<id>\S+)\s*$')
            if (-not $caseMatch.Success) {
                throw 'The qualitative adapter request did not contain a case ID.'
            }
            $caseId = $caseMatch.Groups['id'].Value
            $verdict = if ($caseId -eq 'calibration-deliberately-degraded') { 'fail' } else { 'pass' }
            $findings = @('actionable', 'authority', 'trustworthy') | ForEach-Object {
                [pscustomobject]@{
                    criterion = $_
                    verdict = $verdict
                    evidence = "contract fixture for $caseId"
                    reason = "deterministic mock verdict for $_"
                }
            }
            $result = [pscustomobject]@{
                case_id = $caseId
                verdict = $verdict
                summary = "contract response for $caseId"
                findings = $findings
            }
            $responseObject = @{ output_text = ($result | ConvertTo-Json -Depth 10 -Compress) }
            $responseBytes = [Text.Encoding]::UTF8.GetBytes(($responseObject | ConvertTo-Json -Depth 10 -Compress))
            $context.Response.StatusCode = 200
            $context.Response.ContentType = 'application/json'
            $context.Response.ContentLength64 = $responseBytes.Length
            $context.Response.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
            $context.Response.Close()
            Write-Output "__REQUEST__:$caseId"
        }
    }
    finally {
        $listener.Stop()
        $listener.Close()
    }
} -ArgumentList $prefix, $expectedRequests

try {
    $readyDeadline = (Get-Date).AddSeconds(10)
    $serverReady = $false
    while ((Get-Date) -lt $readyDeadline -and $server.State -notin @('Failed', 'Stopped', 'Completed')) {
        $probeClient = [Net.Sockets.TcpClient]::new()
        try {
            $probeClient.Connect([Net.IPAddress]::Loopback, $port)
            $serverReady = $probeClient.Connected
        }
        catch {
            $serverReady = $false
        }
        finally {
            $probeClient.Dispose()
        }
        if ($serverReady) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $serverReady) {
        throw "The local qualitative API fixture did not start. Job state: $($server.State)"
    }

    & (Join-Path $resolvedRoot 'scripts/invoke-qualitative-gate.ps1') `
        -Root $resolvedRoot `
        -OutputDirectory $reportDirectory `
        -BaseUrl $baseUrl `
        -ApiKey 'qualitative-contract-test-key' `
        -Model '' `
        -RequestTimeoutSeconds 10

    $completed = Wait-Job -Job $server -Timeout 10
    if ($null -eq $completed -or $server.State -ne 'Completed') {
        throw "The local qualitative API fixture did not complete. Job state: $($server.State)"
    }
    $serverOutput = @(Receive-Job -Job $server)
    $requests = @($serverOutput | Where-Object { [string]$_ -like '__REQUEST__:*' })
    if ($requests.Count -ne $expectedRequests) {
        throw "Expected $expectedRequests qualitative API requests, observed $($requests.Count)."
    }

    $missingKeyRejected = $false
    try {
        & (Join-Path $resolvedRoot 'scripts/invoke-qualitative-gate.ps1') `
            -Root $resolvedRoot `
            -OutputDirectory $reportDirectory `
            -BaseUrl $baseUrl `
            -ApiKey '' `
            -Model ''
    }
    catch {
        if ($_.Exception.Message -match 'LLM_API_KEY is required') {
            $missingKeyRejected = $true
        }
        else {
            throw
        }
    }
    if (-not $missingKeyRejected) {
        throw 'The qualitative adapter accepted a missing API key.'
    }

    Write-Output "Qualitative adapter contract test passed: $expectedRequests requests and missing-key rejection."
}
finally {
    if ($server.State -notin @('Completed', 'Failed', 'Stopped')) {
        Stop-Job -Job $server -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $server -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $resolvedRoot $reportDirectory) -Recurse -Force -ErrorAction SilentlyContinue
}
