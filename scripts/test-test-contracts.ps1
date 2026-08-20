[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$storyValidator = Join-Path $Root 'scripts/validate-user-stories.ps1'
$runValidator = Join-Path $Root 'scripts/validate-test-runs.ps1'
& $storyValidator -Root $Root
& $runValidator -Root $Root

$tempBase = [IO.Path]::GetTempPath()
$fixture = Join-Path $tempBase ("test-contracts-" + [guid]::NewGuid().ToString('N'))

function Invoke-ExpectedFailure {
    param(
        [Parameter(Mandatory)] [scriptblock]$Action,
        [Parameter(Mandatory)] [string]$Pattern,
        [Parameter(Mandatory)] [string]$Case
    )
    $failed = $false
    $message = ''
    try { & $Action | Out-Null }
    catch { $failed = $true; $message = $_ | Out-String }
    if (-not $failed -or $message -notmatch $Pattern) {
        throw "$Case did not fail with '$Pattern': $message"
    }
}

try {
    $storyRoot = Join-Path $fixture 'requirements/user-stories'
    $runRoot = Join-Path $fixture 'requirements/test-runs'
    New-Item -ItemType Directory -Path $storyRoot,$runRoot -Force | Out-Null

    $validStory = @'
---
id: US-900
status: ready
risk: high
---

# US-900: Fixture

## 用户故事

- Actor: tester
- Need: validate a concrete contract
- Value: reject empty testing claims

## 验收条件

### AC-001: success

- Type: happy
- Given: a real input
- When: the entrypoint runs
- Then: a falsifiable output exists

### AC-002: failure

- Type: failure
- Given: an invalid input
- When: the entrypoint runs
- Then: state remains recoverable

## 证据映射

- AC-001: planned: fixture success evidence
- AC-002: planned: fixture failure evidence

## 测试设计重点

- 主成功路径: AC-001: exercise the real entrypoint
- 重要失败与恢复: AC-002: reject invalid input and recover
- 变更影响面: validate the direct contract plus repeated invalid input and unchanged isolated state

## 非目标

- adjacent features
'@
    $storyPath = Join-Path $storyRoot 'US-900-fixture.md'
    Set-Content -LiteralPath $storyPath -Value $validStory -Encoding utf8
    $evidenceRoot = Join-Path $fixture 'evidence'
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $evidenceRoot 'fixture-success.log') -Value 'success path observed' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $evidenceRoot 'fixture-failure.log') -Value 'failure path observed and recovered' -Encoding utf8
    & $storyValidator -Root $fixture | Out-Null

    Set-Content -LiteralPath $storyPath -Value ($validStory -replace '(?m)^- 变更影响面:.*\r?\n', '') -Encoding utf8
    Invoke-ExpectedFailure -Case 'missing design focus' -Pattern "测试设计重点缺少 '变更影响面'" -Action { & $storyValidator -Root $fixture }

    Set-Content -LiteralPath $storyPath -Value ($validStory -replace 'AC-002: reject invalid input', 'AC-999: reject invalid input') -Encoding utf8
    Invoke-ExpectedFailure -Case 'unknown AC reference' -Pattern "不存在的验收条件 'AC-999'" -Action { & $storyValidator -Root $fixture }

    Set-Content -LiteralPath $storyPath -Value ($validStory -replace 'AC-002: reject invalid input and recover', 'N/A: isolated fixture has no failure') -Encoding utf8
    Invoke-ExpectedFailure -Case 'high risk cannot omit failure' -Pattern "对 high-risk Story 不能使用 N/A" -Action { & $storyValidator -Root $fixture }

    $lowRiskStory = $validStory -replace 'risk: high', 'risk: low'
    $lowRiskStory = [regex]::Replace($lowRiskStory, '(?ms)^### AC-002: failure\s*.*?(?=^## 证据映射)', '')
    $lowRiskStory = $lowRiskStory `
        -replace '(?m)^- AC-002: planned: fixture failure evidence\r?\n', '' `
        -replace 'AC-002: reject invalid input and recover', 'N/A: this low-risk fixture has no distinct recovery behavior'
    Set-Content -LiteralPath $storyPath -Value $lowRiskStory -Encoding utf8
    & $storyValidator -Root $fixture | Out-Null

    Set-Content -LiteralPath $storyPath -Value $validStory -Encoding utf8
    $validRun = @'
---
story: US-900
commit: working-tree
build: fixture-build-1
environment: isolated-fixture
status: passed
---

# Fixture run

## 真实入口

- Command: pwsh fixture.ps1
- Input: synthetic valid and invalid records
- Output: fixture report in the temporary directory

## 场景结果

- AC-001: passed; evidence=file:evidence/fixture-success.log
- AC-002: passed; evidence=file:evidence/fixture-failure.log

## 数据与副作用

- Before: empty isolated fixture state
- After: expected report only and no external state
- Cleanup: remove the verified temporary fixture directory

## 缺陷与回归

- Defects: none
- Fix: not applicable because this is the passing fixture
- Regression: success failure repetition and unchanged-state assertions

## 交接

- Developer self-test: fixture validators passed locally
- Test handoff: working-tree fixture-build-1 isolated-fixture
- Decision: passed and ready for the contract test
'@
    $runPath = Join-Path $runRoot 'US-900-fixture-run.md'
    Set-Content -LiteralPath $runPath -Value $validRun -Encoding utf8
    & $runValidator -Root $fixture | Out-Null

    Set-Content -LiteralPath $runPath -Value ($validRun -replace 'AC-002: passed', 'AC-002: failed') -Encoding utf8
    Invoke-ExpectedFailure -Case 'inconsistent passed run' -Pattern 'run status is passed' -Action { & $runValidator -Root $fixture }

    Set-Content -LiteralPath $runPath -Value ($validRun -replace 'AC-002: passed', 'AC-999: passed') -Encoding utf8
    Invoke-ExpectedFailure -Case 'unknown run AC' -Pattern "不存在的验收条件 'AC-999'" -Action { & $runValidator -Root $fixture }

    Set-Content -LiteralPath $runPath -Value ($validRun -replace 'file:evidence/fixture-success.log', 'file:evidence/missing.log') -Encoding utf8
    Invoke-ExpectedFailure -Case 'missing run evidence' -Pattern 'evidence file does not exist' -Action { & $runValidator -Root $fixture }

    Write-Output 'Risk-based Story focus and execution-record contracts passed.'
}
finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $prefix = [IO.Path]::GetFullPath($tempBase).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolved).StartsWith('test-contracts-', [StringComparison]::Ordinal) -and
        (Test-Path -LiteralPath $resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
