[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot "sync-codex-profile.ps1"
$installScript = Join-Path $PSScriptRoot "install-codex-profile.ps1"
$previousUserProfile = $env:USERPROFILE
$previousCodexHome = $env:CODEX_HOME
$previousExternalCatalog = $env:CODEX_EXTERNAL_SKILL_CATALOG
$previousExternalRoot = $env:CODEX_EXTERNAL_SKILL_ROOT

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Check
if ($LASTEXITCODE -ne 0) { throw "The committed profile differs from the installed source profile." }

$missingHome = Join-Path $env:TEMP ("codex-profile-missing-" + [guid]::NewGuid().ToString("N"))
$previousErrorPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -UserHome $missingHome -Check *> $null
  $missingExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorPreference
}
if ($missingExitCode -eq 0) { throw "The sync check accepted a missing source profile." }

$testRoot = Join-Path $env:TEMP ("codex-profile-install-" + [guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path (Join-Path $testRoot ".codex") -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $testRoot ".codex\AGENTS.md"),
    "old-profile-marker",
    [Text.UTF8Encoding]::new($false)
  )

  $externalRoot = Join-Path $testRoot "external-skills"
  $externalSkillDirectory = Join-Path $externalRoot "fixture-zephyrquartz"
  New-Item -ItemType Directory -Path $externalSkillDirectory -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $externalSkillDirectory "SKILL.md"),
    "---`nname: zephyrquartz-cost-tuning`ndescription: fixture`n---`nEXTERNAL_SKILL_BODY_MUST_NOT_BE_INDEXED",
    [Text.UTF8Encoding]::new($false)
  )
  $externalCatalogPath = Join-Path $externalRoot "_catalog_cn.json"
  $externalCatalog = [ordered]@{
    stats = [ordered]@{ active_skills = 1 }
    skills = @([ordered]@{
      dir = "fixture-zephyrquartz"
      name = "zephyrquartz-cost-tuning"
      key = "zephyrquartz-cost-tuning"
      c1 = "测试分类"
      c2 = "成本测试"
      description = "Optimize ZephyrQuartz billing costs and usage."
      problem_cn = "分析 ZephyrQuartz 计费成本。"
      when_cn = "需要分析 ZephyrQuartz billing 时使用。"
    })
  }
  [IO.File]::WriteAllText($externalCatalogPath, ($externalCatalog | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $env:USERPROFILE = $testRoot
  $env:CODEX_HOME = Join-Path $testRoot ".codex"
  $env:CODEX_EXTERNAL_SKILL_ROOT = $externalRoot
  $env:CODEX_EXTERNAL_SKILL_CATALOG = $externalCatalogPath

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript -UserHome $testRoot -SkipDesktopShortcuts
  if ($LASTEXITCODE -ne 0) { throw "The portable profile installer failed." }

  $hooksPath = Join-Path $testRoot ".codex\hooks.json"
  $hooks = Get-Content -Raw -LiteralPath $hooksPath | ConvertFrom-Json
  $routerCommand = [string]$hooks.hooks.UserPromptSubmit[0].hooks[0].command
  if ($routerCommand -notlike "*$testRoot*") { throw "hooks.json does not use the target user profile path." }
  if ([int]$hooks.hooks.UserPromptSubmit[0].hooks[0].timeout -ne 10) { throw "The Skill router timeout is not configured for the external catalog." }
  if ([int]$hooks.hooks.UserPromptSubmit[0].hooks[1].additionalContextLimit -ne 10000) { throw "The context hook does not reserve room for conditional tool batching instructions." }
  if ([int]$hooks.hooks.SessionStart[0].hooks[1].timeout -ne 60) { throw "The Skill refresh timeout is not configured for the first external index build." }

  $backup = Get-ChildItem -LiteralPath (Join-Path $testRoot ".codex\backups\portable-profile") -Filter "AGENTS.md" -Recurse -File | Select-Object -First 1
  if (-not $backup -or (Get-Content -Raw -LiteralPath $backup.FullName) -ne "old-profile-marker") {
    throw "The installer did not preserve the previous managed file."
  }

  $skillCount = (Get-ChildItem -LiteralPath (Join-Path $testRoot ".agents\skills") -Filter "SKILL.md" -Recurse -File).Count
  if ($skillCount -ne 6) { throw "Expected 6 custom Skills, found $skillCount." }

  $registryText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\skills-index.json")
  if ($registryText -notmatch '"name"\s*:\s*"method-github-delivery"') {
    throw "The installed Skill registry is missing method-github-delivery."
  }
  $routingText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\routing-rules.json")
  if ($routingText -notmatch '"method-github-delivery"\s*:\s*\[[^\]]*"GitHub"') {
    throw "The installed routing aliases are missing the GitHub trigger."
  }

  $registry = $registryText | ConvertFrom-Json
  if ([int]$registry.externalSkillCount -ne 1) { throw "Expected one indexed external Skill." }
  $externalIndexPath = Join-Path $testRoot ".codex\skill-registry\external-skills.tsv"
  $externalManifestPath = Join-Path $testRoot ".codex\skill-registry\external-skills-manifest.json"
  $externalIndexText = Get-Content -LiteralPath $externalIndexPath -Raw
  if ($externalIndexText -notmatch 'zephyrquartz-cost-tuning' -or $externalIndexText -notmatch [regex]::Escape((Join-Path $externalSkillDirectory "SKILL.md"))) {
    throw "The external index is missing the fixture Skill or its real path."
  }
  if ($externalIndexText -match 'EXTERNAL_SKILL_BODY_MUST_NOT_BE_INDEXED') {
    throw "The external index preloaded Skill body content."
  }

  $router = Join-Path $testRoot ".codex\hooks\skill-router.ps1"
  $routeInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Analyze ZephyrQuartz billing costs"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $routeOutput = $routeInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $router
  $routeContext = [string](($routeOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($routeContext -notmatch 'zephyrquartz-cost-tuning' -or $routeContext -notmatch [regex]::Escape((Join-Path $externalSkillDirectory "SKILL.md"))) {
    throw "The Skill router did not recommend the relevant external Skill. Output: $(($routeOutput | Out-String).Trim())"
  }
  $unrelatedInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Write a short greeting"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $unrelatedOutput = $unrelatedInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $router
  if (($unrelatedOutput | Out-String).Trim() -ne "{}") { throw "The Skill router recommended an external Skill for an unrelated prompt." }

  $contextRefresh = Join-Path $testRoot ".codex\hooks\context-refresh.ps1"
  $toolHeavyInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "请高并发检查多个文件并运行测试"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $toolHeavyOutput = $toolHeavyInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $contextRefresh
  $toolHeavyContext = [string](($toolHeavyOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($toolHeavyContext -notmatch '\[TOOL_BATCHING_EXECUTION_CONTRACT_V1\]' -or $toolHeavyContext -notmatch 'Promise\.all') {
    throw "The context hook did not inject the tool batching execution contract for a tool-heavy prompt."
  }
  $plainConcurrencyInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "我不知道为什么，现在我感觉还是没有并发，你确定现在是可以并发了吗？"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $plainConcurrencyOutput = $plainConcurrencyInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $contextRefresh
  $plainConcurrencyContext = [string](($plainConcurrencyOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($plainConcurrencyContext -notmatch '\[TOOL_BATCHING_EXECUTION_CONTRACT_V1\]') {
    throw "The context hook did not recognize the user's plain concurrency wording."
  }
  $simpleInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "你好"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $simpleOutput = $simpleInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $contextRefresh
  $simpleContext = [string](($simpleOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($simpleContext -match '\[TOOL_BATCHING_EXECUTION_CONTRACT_V1\]') {
    throw "The context hook injected the tool batching contract for a simple greeting."
  }

  $refresh = Join-Path $testRoot ".codex\hooks\refresh-skill-registry.ps1"
  $refreshInput = @{ hook_event_name = "SessionStart"; source = "startup"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $manifestBefore = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  $refreshInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $refresh | Out-Null
  $manifestCached = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  if ([string]$manifestCached.generatedAt -ne [string]$manifestBefore.generatedAt) { throw "An unchanged external catalog was rebuilt instead of using the cache." }

  $secondDirectory = Join-Path $externalRoot "fixture-second"
  New-Item -ItemType Directory -Path $secondDirectory -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $secondDirectory "SKILL.md"), "---`nname: second-fixture`ndescription: fixture`n---", [Text.UTF8Encoding]::new($false))
  $externalCatalog.skills += [ordered]@{
    dir = "fixture-second"
    name = "second-fixture"
    key = "second-fixture"
    c1 = "测试分类"
    c2 = "缓存测试"
    description = "Second fixture for cache invalidation."
    problem_cn = "验证外部索引失效检测。"
    when_cn = "目录发生变化时使用。"
  }
  $externalCatalog.stats.active_skills = 2
  [IO.File]::WriteAllText($externalCatalogPath, ($externalCatalog | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $refreshInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $refresh | Out-Null
  $manifestUpdated = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  if ([int]$manifestUpdated.skillCount -ne 2) { throw "The external index did not rebuild after its catalog changed." }

  Write-Host "PASS: profile sync, clean install, backup, generated paths, 6 custom Skills, external indexing, cache invalidation, body isolation, prompt routing, and conditional tool batching injection."
} finally {
  $env:USERPROFILE = $previousUserProfile
  $env:CODEX_HOME = $previousCodexHome
  $env:CODEX_EXTERNAL_SKILL_CATALOG = $previousExternalCatalog
  $env:CODEX_EXTERNAL_SKILL_ROOT = $previousExternalRoot
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporaryRoot = [IO.Path]::GetFullPath($env:TEMP)
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean a test directory outside TEMP: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
