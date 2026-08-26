[CmdletBinding()]
param([switch]$SkipSourceSyncCheck)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot "sync-codex-profile.ps1"
$installScript = Join-Path $PSScriptRoot "install-codex-profile.ps1"
$previousUserProfile = $env:USERPROFILE
$previousCodexHome = $env:CODEX_HOME
$previousExternalCatalog = $env:CODEX_EXTERNAL_SKILL_CATALOG
$previousExternalRoot = $env:CODEX_EXTERNAL_SKILL_ROOT

if (-not $SkipSourceSyncCheck) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Check
  if ($LASTEXITCODE -ne 0) { throw "The committed profile differs from the installed source profile." }
}

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
  if (@($hooks.hooks.UserPromptSubmit[0].hooks).Count -ne 1 -or @($hooks.hooks.SessionStart[0].hooks).Count -ne 1) { throw "hooks.json does not use one stable dispatcher per event." }
  $dispatcherCommand = [string]$hooks.hooks.UserPromptSubmit[0].hooks[0].command
  if ($dispatcherCommand -notlike "*$testRoot*" -or $dispatcherCommand -notlike "*hook-dispatch.mjs*") { throw "hooks.json does not use the target user profile dispatcher path." }
  if ([int]$hooks.hooks.UserPromptSubmit[0].hooks[0].timeout -ne 20) { throw "The prompt dispatcher timeout is not configured." }
  if ([int]$hooks.hooks.UserPromptSubmit[0].hooks[0].additionalContextLimit -ne 0) { throw "The prompt dispatcher does not pass the full additional context directly." }
  if ([int]$hooks.hooks.SessionStart[0].hooks[0].timeout -ne 70) { throw "The session dispatcher timeout is not configured for index refresh." }
  if ([int]$hooks.hooks.SessionStart[0].hooks[0].additionalContextLimit -ne 0) { throw "The session dispatcher does not pass the full additional context directly." }

  $backup = Get-ChildItem -LiteralPath (Join-Path $testRoot ".codex\backups\portable-profile") -Filter "AGENTS.md" -Recurse -File | Select-Object -First 1
  if (-not $backup -or (Get-Content -Raw -LiteralPath $backup.FullName) -ne "old-profile-marker") {
    throw "The installer did not preserve the previous managed file."
  }

  $directUserSkillRoot = Join-Path $testRoot ".agents\skills"
  $directUserSkillCount = if (Test-Path -LiteralPath $directUserSkillRoot -PathType Container) { @(Get-ChildItem -LiteralPath $directUserSkillRoot -Filter "SKILL.md" -Recurse -File).Count } else { 0 }
  if ($directUserSkillCount -ne 0) { throw "User Skills remain in the platform auto-scan directory: $directUserSkillCount" }
  $routedUserSkillRoot = Join-Path $testRoot ".agents\routed-skills"
  $skillCount = (Get-ChildItem -LiteralPath $routedUserSkillRoot -Filter "SKILL.md" -Recurse -File).Count
  if ($skillCount -ne 6) { throw "Expected 6 custom Skills, found $skillCount." }

  $registryText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\skills-index.json")
  if ($registryText -notmatch '"name"\s*:\s*"method-github-delivery"') {
    throw "The installed Skill registry is missing method-github-delivery."
  }
  $routingText = Get-Content -Raw -LiteralPath (Join-Path $testRoot ".codex\skill-registry\routing-rules.json")
  if ($routingText -notmatch '"method-github-delivery"\s*:\s*\[[^\]]*"GitHub"') {
    throw "The installed routing aliases are missing the GitHub trigger."
  }
  if ($routingText -notmatch '"apple-design"\s*:\s*\[[^\]]*"draggable bottom sheet"') {
    throw "The installed routing aliases are missing the apple-design gesture trigger."
  }
  if ($routingText -notmatch '"build-designed-interface"\s*:\s*\[[^\]]*"responsive frontend landing page"') {
    throw "The installed routing aliases are missing the designed-interface trigger."
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

  $router = Join-Path $testRoot ".codex\hooks\skill-router.mjs"
  $routeInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Analyze ZephyrQuartz billing costs"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $routeOutput = $routeInput | & node $router
  $routeContext = [string](($routeOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($routeContext -notmatch 'zephyrquartz-cost-tuning' -or $routeContext -notmatch [regex]::Escape((Join-Path $externalSkillDirectory "SKILL.md"))) {
    $previousDebug = $env:CODEX_SKILL_ROUTER_DEBUG
    try {
      $env:CODEX_SKILL_ROUTER_DEBUG = "1"
      $diagnosticOutput = $routeInput | & node $router 2>&1
    } finally {
      $env:CODEX_SKILL_ROUTER_DEBUG = $previousDebug
    }
    throw "The Skill router did not recommend the relevant external Skill. Input: $routeInput Output: $(($routeOutput | Out-String).Trim()) Diagnostic: $(($diagnosticOutput | Out-String).Trim())"
  }
  if ($routeContext -match 'Optimize ZephyrQuartz billing costs and usage') {
    throw "The Skill router injected an unfiltered external Skill description."
  }
  if (($routeContext -split '(?m)^\s*Read:\s*').Count -ne 2) {
    throw "The Skill router emitted more than one selected Skill. Output: $routeContext"
  }
  $previousRouterTimeout = $env:CODEX_SKILL_ROUTER_RG_TIMEOUT_MS
  try {
    $env:CODEX_SKILL_ROUTER_RG_TIMEOUT_MS = "1"
    $timeoutRouteOutput = $routeInput | & node $router
    $timeoutRouteContext = [string](($timeoutRouteOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
    if ($timeoutRouteContext -notmatch 'zephyrquartz-cost-tuning') {
      throw "The Skill router did not fall back to streamed index search after rg timed out. Output: $(($timeoutRouteOutput | Out-String).Trim())"
    }
  } finally {
    $env:CODEX_SKILL_ROUTER_RG_TIMEOUT_MS = $previousRouterTimeout
  }
  $unrelatedInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Write a short greeting"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $unrelatedOutput = $unrelatedInput | & node $router
  if (($unrelatedOutput | Out-String).Trim() -ne "{}") { throw "The Skill router recommended an external Skill for an unrelated prompt." }
  $ambiguousInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Design a web page"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $ambiguousOutput = $ambiguousInput | & node $router
  if (($ambiguousOutput | Out-String).Trim() -ne "{}") { throw "The Skill router selected a Skill for an ambiguous generic prompt." }

  $githubInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Commit and push these changes to GitHub"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $githubOutput = $githubInput | & node $router
  $githubContext = [string](($githubOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($githubContext -notmatch 'method-github-delivery' -or $githubContext -notmatch [regex]::Escape((Join-Path $routedUserSkillRoot 'method-github-delivery\SKILL.md'))) {
    throw "The Skill router did not recommend the Router-only user method-github-delivery Skill. Output: $(($githubOutput | Out-String).Trim())"
  }
  if ($githubContext -notmatch 'source=agents') {
    throw "The Skill router did not preserve the user Skill source label. Output: $(($githubOutput | Out-String).Trim())"
  }

  $directProjectSkillRoot = Join-Path $repositoryRoot '.agents\skills'
  $directProjectSkillCount = if (Test-Path -LiteralPath $directProjectSkillRoot -PathType Container) { @(Get-ChildItem -LiteralPath $directProjectSkillRoot -Filter 'SKILL.md' -Recurse -File).Count } else { 0 }
  if ($directProjectSkillCount -ne 0) { throw "Project Skills remain in the platform auto-scan directory: $directProjectSkillCount" }
  $routedProjectSkillRoot = Join-Path $repositoryRoot '.agents\routed-skills'
  $routedProjectSkillCount = @(Get-ChildItem -LiteralPath $routedProjectSkillRoot -Filter 'SKILL.md' -Recurse -File).Count
  if ($routedProjectSkillCount -ne 17) { throw "Expected 17 Router-only project Skills, found $routedProjectSkillCount." }

  $frontendInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Build a responsive frontend landing page for an AI product"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $frontendOutput = $frontendInput | & node $router
  $frontendContext = [string](($frontendOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($frontendContext -notmatch 'build-designed-interface' -or $frontendContext -notmatch [regex]::Escape((Join-Path $repositoryRoot '.agents\routed-skills\build-designed-interface\SKILL.md'))) {
    throw "The Skill router did not recommend the nearest project build-designed-interface Skill. Output: $(($frontendOutput | Out-String).Trim())"
  }
  if ($frontendContext -notmatch '\[CODEX_SKILL_ROUTER_V4\]' -or $frontendContext -notmatch 'source=project') {
    throw "The Skill router did not expose the compact unified candidate. Output: $(($frontendOutput | Out-String).Trim())"
  }
  if ($frontendContext -match 'Unified scope|metadata-only|Evidence:') {
    throw "The Skill router repeated fixed routing explanations instead of returning compact candidates. Output: $(($frontendOutput | Out-String).Trim())"
  }
  if ([regex]::Matches($frontendContext, '(?m)^\s*Read:\s*').Count -gt 4) {
    throw "The Skill router emitted more than four candidates. Output: $(($frontendOutput | Out-String).Trim())"
  }

  $gestureInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "Design a draggable bottom sheet with spring physics and interruption"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $gestureOutput = $gestureInput | & node $router
  $gestureContext = [string](($gestureOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($gestureContext -notmatch 'apple-design' -or $gestureContext -notmatch [regex]::Escape((Join-Path $repositoryRoot '.agents\routed-skills\apple-design\SKILL.md'))) {
    throw "The Skill router did not recommend the nearest project apple-design Skill. Output: $(($gestureOutput | Out-String).Trim())"
  }

  $contextRefresh = Join-Path $testRoot ".codex\hooks\hook-dispatch.mjs"
  $dispatcherText = Get-Content -Raw -LiteralPath $contextRefresh
  if ($dispatcherText -notmatch 'Promise\.all\(handlers\.map' -or $dispatcherText -notmatch 'CODEX_CAPABILITY_HOOK' -or $dispatcherText -notmatch 'own\("skill-router"') {
    throw "The stable dispatcher no longer runs Skill routing and the capability/graph hook through the existing parallel architecture."
  }
  $toolHeavyInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "请高并发检查多个文件并运行测试"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $toolHeavyOutput = $toolHeavyInput | & node $contextRefresh
  $toolHeavyContext = [string](($toolHeavyOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if (-not $toolHeavyContext.StartsWith('[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3]') -or
      $toolHeavyContext -notmatch 'Promise\.all' -or
      $toolHeavyContext -notmatch 'K = min\(8, the independent count\)' -or
      $toolHeavyContext -notmatch 'mechanically determined follow-up waves' -or
      $toolHeavyContext -notmatch 'process every listed item in the first wave') {
    throw "The context hook did not inject the automatic tool batching contract."
  }
  if ($toolHeavyContext -notmatch '\[CODEX_SKILL_ROUTER_GATE_V1\]' -or $toolHeavyContext -notmatch 'metadata-only' -or $toolHeavyContext -notmatch 'exact path') {
    throw "The context hook did not inject the Skill routing gate."
  }
  $plainConcurrencyInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "我不知道为什么，现在我感觉还是没有并发，你确定现在是可以并发了吗？"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $plainConcurrencyOutput = $plainConcurrencyInput | & node $contextRefresh
  $plainConcurrencyContext = [string](($plainConcurrencyOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($plainConcurrencyContext -notmatch '\[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3\]') {
    throw "The context hook did not inject automatic batching for the user's concurrency wording."
  }
  $simpleInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "你好"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $simpleOutput = $simpleInput | & node $contextRefresh
  $simpleContext = [string](($simpleOutput | ConvertFrom-Json).hookSpecificOutput.additionalContext)
  if ($simpleContext -notmatch '\[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3\]') {
    throw "The context hook did not inject automatic batching for a simple prompt."
  }

  $refresh = Join-Path $testRoot ".codex\hooks\refresh-skill-registry.ps1"
  $refreshInput = @{ hook_event_name = "SessionStart"; source = "startup"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $manifestBefore = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  $refreshInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $refresh | Out-Null
  $manifestCached = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  if ([string]$manifestCached.generatedAt -ne [string]$manifestBefore.generatedAt) { throw "An unchanged external catalog was rebuilt instead of using the cache." }

  $secondDirectory = Join-Path $externalRoot "fixture-second"
  New-Item -ItemType Directory -Path $secondDirectory -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $secondDirectory "SKILL.md"), "---`nname: awareness-stage-mapper`ndescription: fixture`n---", [Text.UTF8Encoding]::new($false))
  $externalCatalog.skills += [ordered]@{
    dir = "fixture-second"
    name = "awareness-stage-mapper"
    key = "awareness-stage-mapper"
    c1 = "人工智能与智能体"
    c2 = "智能体流程与自动化"
    description = "One sentence - what this skill does and when to invoke it"
    problem_cn = "一句话——该技能的作用以及何时调用它。"
    when_cn = "工作目标属于智能体流程与自动化时使用。"
  }
  $externalCatalog.stats.active_skills = 2
  [IO.File]::WriteAllText($externalCatalogPath, ($externalCatalog | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  $refreshInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $refresh | Out-Null
  $manifestUpdated = Get-Content -LiteralPath $externalManifestPath -Raw | ConvertFrom-Json
  if ([int]$manifestUpdated.skillCount -ne 2) { throw "The external index did not rebuild after its catalog changed." }
  $updatedIndexText = Get-Content -LiteralPath $externalIndexPath -Raw
  if ($updatedIndexText -match 'One sentence - what this skill does' -or $updatedIndexText -match '该技能的作用以及何时调用它') {
    throw "The external index retained placeholder Skill metadata."
  }
  $placeholderInput = @{ hook_event_name = "UserPromptSubmit"; prompt = "把这一句话精简一下"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $placeholderOutput = $placeholderInput | & node $router
  if (($placeholderOutput | Out-String).Trim() -ne "{}") { throw "Placeholder external metadata caused a false Skill route." }

  Write-Host "PASS: profile sync, clean install, backup, generated paths, 6 custom Skills, external indexing, placeholder filtering, cache invalidation, body isolation, prompt routing, and automatic per-turn tool batching injection."
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
