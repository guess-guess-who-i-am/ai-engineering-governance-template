[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $Root 'scripts/validate-skills.ps1'
& $validator -Root $Root | Out-Null

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("skill-validation-" + [guid]::NewGuid().ToString('N'))
$fixtureSkills = Join-Path $fixtureRoot '.agents/skills'
$fixtureScripts = Join-Path $fixtureRoot 'scripts'
New-Item -ItemType Directory -Path $fixtureSkills, $fixtureScripts -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'scripts/validate-skill.ps1') -Destination $fixtureScripts
Copy-Item -LiteralPath (Join-Path $Root 'scripts/validate-skills.ps1') -Destination $fixtureScripts

function Add-FixtureSkill {
    param([string]$Name, [string]$DisplayName, [string]$Description, [string]$Prompt)
    $skillRoot = Join-Path $fixtureSkills $Name
    New-Item -ItemType Directory -Path (Join-Path $skillRoot 'agents') -Force | Out-Null
    @"
---
name: $Name
description: Use when validating a fixture Skill package.
---
# Fixture
"@ | Set-Content -LiteralPath (Join-Path $skillRoot 'SKILL.md') -Encoding utf8
    @"
interface:
  display_name: "$DisplayName"
  short_description: "$Description"
  default_prompt: "$Prompt"
"@ | Set-Content -LiteralPath (Join-Path $skillRoot 'agents/openai.yaml') -Encoding utf8
}

function Assert-Rejected {
    param([string]$ExpectedMessage)
    try {
        & $validator -Root $fixtureRoot 2>&1 | Out-Null
        throw "Expected validation to reject fixture containing: $ExpectedMessage"
    }
    catch {
        $failure = $_ | Out-String
        if ($failure -notmatch [regex]::Escape($ExpectedMessage)) {
            throw "Validation failed for the wrong reason. Expected '$ExpectedMessage'; got: $failure"
        }
    }
}

try {
    Add-FixtureSkill -Name 'valid-fixture' -DisplayName '有效样例' -Description '这是一个用于证明元数据契约能够正常通过验证的中文测试描述' -Prompt '使用 $valid-fixture 验证这个有效样例。'
    & $validator -Root $fixtureRoot | Out-Null

    $metadata = Join-Path $fixtureSkills 'valid-fixture/agents/openai.yaml'
    (Get-Content -LiteralPath $metadata -Raw).Replace('有效样例', "坏$([char]0xFFFD)样例") |
        Set-Content -LiteralPath $metadata -Encoding utf8
    Assert-Rejected -ExpectedMessage 'replacement or mojibake markers'

    Remove-Item -LiteralPath (Join-Path $fixtureSkills 'valid-fixture') -Recurse -Force
    Add-FixtureSkill -Name 'valid-fixture' -DisplayName '有效样例' -Description '太短的中文描述' -Prompt '使用 $valid-fixture 验证这个有效样例。'
    Assert-Rejected -ExpectedMessage 'must be 25-64 characters'

    Remove-Item -LiteralPath (Join-Path $fixtureSkills 'valid-fixture') -Recurse -Force
    Add-FixtureSkill -Name 'valid-fixture' -DisplayName '有效样例' -Description '这是一个用于证明元数据契约能够正常通过验证的中文测试描述' -Prompt '使用 $valid-fixture 验证这个有效样例。'
    (Get-Content -LiteralPath $metadata -Raw).Replace('$valid-fixture', '$wrong-skill') |
        Set-Content -LiteralPath $metadata -Encoding utf8
    Assert-Rejected -ExpectedMessage 'must reference exactly $valid-fixture'

    Remove-Item -LiteralPath (Join-Path $fixtureSkills 'valid-fixture') -Recurse -Force
    Add-FixtureSkill -Name 'first-fixture' -DisplayName '重复显示名' -Description '这是第一个用于验证显示名称不能发生重复的中文测试描述' -Prompt '使用 $first-fixture 验证第一个样例。'
    Add-FixtureSkill -Name 'second-fixture' -DisplayName '重复显示名' -Description '这是第二个用于验证显示名称不能发生重复的中文测试描述' -Prompt '使用 $second-fixture 验证第二个样例。'
    Assert-Rejected -ExpectedMessage 'duplicate interface.display_name'
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

Write-Output 'Skill validation positive and negative cases passed.'
