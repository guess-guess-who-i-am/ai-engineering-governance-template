[CmdletBinding()]
param(
  [ValidateSet('Apply', 'Restore')]
  [string]$Mode = 'Apply',
  [string]$UserHome = $env:USERPROFILE,
  [string]$BackupPath
)

$ErrorActionPreference = 'Stop'
$codexHome = Join-Path $UserHome '.codex'
$agentsHome = Join-Path $UserHome '.agents'
$deferredCodex = Join-Path $codexHome 'deferred-skills\codex'
$deferredAgents = Join-Path $agentsHome 'deferred-skills'
$coreAgentSkills = @(
  'manage-global-methodology',
  'method-engineering-execution',
  'method-evaluation-gates',
  'method-github-delivery',
  'method-research-evidence',
  'method-task-tree',
  'find-skills',
  'write-a-skill'
)

function Copy-FileIfPresent([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Remove-TomlSection([string]$Text, [string]$Section) {
  $escaped = [regex]::Escape($Section)
  return [regex]::Replace($Text, "(?ms)^\[$escaped\]\s*.*?(?=^\[|\z)", '')
}

function Get-TomlSection([string]$Text, [string]$Section) {
  $escaped = [regex]::Escape($Section)
  $match = [regex]::Match($Text, "(?ms)^\[$escaped\]\s*.*?(?=^\[|\z)")
  if (-not $match.Success) { return '' }
  return $match.Value.Trim() + [Environment]::NewLine
}

function Set-TomlSectionEnabled([string]$Text, [string]$Section, [bool]$Enabled) {
  $escaped = [regex]::Escape($Section)
  $match = [regex]::Match($Text, "(?ms)^\[$escaped\][ \t]*\r?\n.*?(?=^\[|\z)")
  if (-not $match.Success) { return $Text }

  $value = $Enabled.ToString().ToLowerInvariant()
  $sectionText = $match.Value
  if ([regex]::IsMatch($sectionText, '(?m)^enabled\s*=')) {
    $sectionText = [regex]::Replace($sectionText, '(?m)^(enabled\s*=\s*).*$', "`${1}$value")
  }
  else {
    $header = [regex]::Match($sectionText, "^\[$escaped\][ \t]*\r?\n")
    $sectionText = $sectionText.Insert($header.Length, "enabled = $value$([Environment]::NewLine)")
  }
  return $Text.Substring(0, $match.Index) + $sectionText + $Text.Substring($match.Index + $match.Length)
}

function Set-TomlFeature([string]$Text, [string]$Name, [bool]$Enabled) {
  $match = [regex]::Match($Text, '(?ms)^\[features\][ \t]*\r?\n.*?(?=^\[|\z)')
  if (-not $match.Success) { throw 'Codex config has no [features] section.' }

  $escaped = [regex]::Escape($Name)
  $value = $Enabled.ToString().ToLowerInvariant()
  $sectionText = $match.Value
  if ([regex]::IsMatch($sectionText, "(?m)^$escaped\s*=")) {
    $sectionText = [regex]::Replace($sectionText, "(?m)^($escaped\s*=\s*).*$", "`${1}$value")
  }
  else {
    $header = [regex]::Match($sectionText, '^\[features\][ \t]*\r?\n')
    $sectionText = $sectionText.Insert($header.Length, "$Name = $value$([Environment]::NewLine)")
  }
  return $Text.Substring(0, $match.Index) + $sectionText + $Text.Substring($match.Index + $match.Length)
}

function Write-Utf8([string]$Path, [string]$Text) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Assert-TextMatch([string]$Text, [string]$Pattern, [string]$Message) {
  if ($Text -notmatch $Pattern) { throw $Message }
}

function Move-DeferredSkills([string]$SourceRoot, [string]$DestinationRoot, [string[]]$KeepNames) {
  if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { return @() }
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  $moved = [Collections.Generic.List[object]]::new()
  foreach ($directory in @(Get-ChildItem -LiteralPath $SourceRoot -Directory)) {
    if ($KeepNames -contains $directory.Name) { continue }
    $destination = Join-Path $DestinationRoot $directory.Name
    if (Test-Path -LiteralPath $destination) { throw "Deferred Skill destination already exists: $destination" }
    Move-Item -LiteralPath $directory.FullName -Destination $destination
    $moved.Add([ordered]@{ source = $directory.FullName; destination = $destination; name = $directory.Name })
  }
  return @($moved)
}

function Write-Profiles([string]$ConfigText, [string]$ProfileRoot) {
  $nodeSection = Set-TomlSectionEnabled (Get-TomlSection $ConfigText 'mcp_servers.node_repl') 'mcp_servers.node_repl' $true
  $node = $nodeSection + (Get-TomlSection $ConfigText 'mcp_servers.node_repl.env')
  $tree = Set-TomlSectionEnabled (Get-TomlSection $ConfigText 'mcp_servers.task_tree') 'mcp_servers.task_tree' $true
  $plugins = @('documents@openai-primary-runtime', 'pdf@openai-primary-runtime', 'spreadsheets@openai-primary-runtime', 'presentations@openai-primary-runtime', 'template-creator@openai-primary-runtime', 'task-tree@llm-task-tree')
  $pluginSections = ($plugins | ForEach-Object {
    "[plugins.`"$_`"]`n`nenabled = true`n"
  }) -join "`n"
  $pluginFeatures = "[features]`nplugins = true`nremote_plugin = false`n"

  Write-Utf8 (Join-Path $ProfileRoot 'task-tree.config.toml') ("[features]`nenable_mcp_apps = true`nremote_plugin = false`n`n" + $tree)
  Write-Utf8 (Join-Path $ProfileRoot 'browser.config.toml') ("[features]`nenable_mcp_apps = true`n`n" + $node)
  Write-Utf8 (Join-Path $ProfileRoot 'full-tools.config.toml') ("[features]`nenable_mcp_apps = true`nmulti_agent = true`nplugins = true`nremote_plugin = false`n`n" + $node + "`n" + $tree + "`n" + $pluginSections)
  foreach ($plugin in @($plugins | Where-Object { $_ -ne 'task-tree@llm-task-tree' })) {
    $fileName = ($plugin -replace '@.*$', '') + '.config.toml'
    Write-Utf8 (Join-Path $ProfileRoot $fileName) ($pluginFeatures + "`n[plugins.`"$plugin`"]`n`nenabled = true`n")
  }

  $taskTreeProfile = [IO.File]::ReadAllText((Join-Path $ProfileRoot 'task-tree.config.toml'))
  $browserProfile = [IO.File]::ReadAllText((Join-Path $ProfileRoot 'browser.config.toml'))
  $fullToolsProfile = [IO.File]::ReadAllText((Join-Path $ProfileRoot 'full-tools.config.toml'))
  if ($tree) {
    Assert-TextMatch $taskTreeProfile '(?m)^\[mcp_servers\.task_tree\]$' 'The task-tree profile lost its MCP section.'
    Assert-TextMatch $taskTreeProfile '(?ms)^\[mcp_servers\.task_tree\].*?^enabled\s*=\s*true[ \t]*\r?$' 'The task-tree profile does not enable its MCP.'
    Assert-TextMatch $fullToolsProfile '(?m)^\[mcp_servers\.task_tree\]$' 'The full-tools profile lost the task-tree MCP section.'
    Assert-TextMatch $taskTreeProfile '(?m)^remote_plugin\s*=\s*false[ \t]*\r?$' 'The task-tree profile allows remote plugin catalog sync.'
  }
  if ($nodeSection) {
    Assert-TextMatch $browserProfile '(?ms)^\[mcp_servers\.node_repl\].*?^enabled\s*=\s*true[ \t]*\r?$' 'The browser profile does not enable node_repl.'
    Assert-TextMatch $fullToolsProfile '(?ms)^\[mcp_servers\.node_repl\].*?^enabled\s*=\s*true[ \t]*\r?$' 'The full-tools profile does not enable node_repl.'
  }
  Assert-TextMatch $fullToolsProfile '(?m)^remote_plugin\s*=\s*false[ \t]*\r?$' 'The full-tools profile allows remote plugin catalog sync.'
}

if ($Mode -eq 'Restore') {
  if (-not $BackupPath) { throw 'Restore requires -BackupPath pointing to a lazy-capabilities backup.' }
  $backup = [IO.Path]::GetFullPath($BackupPath)
  $manifestPath = Join-Path $backup 'MANIFEST.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Backup manifest not found: $manifestPath" }
  foreach ($relative in @('.codex\config.toml', '.codex\hooks.json')) {
    Copy-FileIfPresent (Join-Path $backup $relative) (Join-Path $UserHome $relative)
  }
  foreach ($directory in @('hooks', 'skill-registry')) {
    $source = Join-Path $backup ".codex\$directory"
    if (Test-Path -LiteralPath $source -PathType Container) {
      $destination = Join-Path $codexHome $directory
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
      Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
    }
  }
  foreach ($archive in @($deferredCodex, $deferredAgents)) {
    if (-not (Test-Path -LiteralPath $archive -PathType Container)) { continue }
    $target = if ($archive -eq $deferredCodex) { Join-Path $codexHome 'skills' } else { Join-Path $agentsHome 'skills' }
    foreach ($directory in @(Get-ChildItem -LiteralPath $archive -Directory)) {
      $destination = Join-Path $target $directory.Name
      if (Test-Path -LiteralPath $destination) { throw "Cannot restore over existing Skill directory: $destination" }
      Move-Item -LiteralPath $directory.FullName -Destination $destination
    }
  }
  Write-Host "Restored lazy-capability backup: $backup"
  exit 0
}

$configPath = Join-Path $codexHome 'config.toml'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Codex config not found: $configPath" }
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = if ($BackupPath) { [IO.Path]::GetFullPath($BackupPath) } else { Join-Path $codexHome "backups\lazy-capabilities\$timestamp" }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-FileIfPresent $configPath (Join-Path $backupRoot '.codex\config.toml')
Copy-FileIfPresent (Join-Path $codexHome 'hooks.json') (Join-Path $backupRoot '.codex\hooks.json')
foreach ($directory in @('hooks', 'skill-registry')) {
  $source = Join-Path $codexHome $directory
  if (Test-Path -LiteralPath $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot ".codex\$directory") -Recurse -Force
  }
}

$originalConfigText = [IO.File]::ReadAllText($configPath)
$configText = $originalConfigText
foreach ($section in @('mcp_servers.task_tree')) {
  $configText = Remove-TomlSection $configText $section
}
$configText = Set-TomlSectionEnabled $configText 'mcp_servers.node_repl' $false
$configText = [regex]::Replace($configText, '(?m)^enable_mcp_apps\s*=\s*.*$', 'enable_mcp_apps = false')
$configText = [regex]::Replace($configText, '(?m)^multi_agent\s*=\s*.*$', 'multi_agent = false')
$configText = Set-TomlFeature $configText 'plugins' $false
$configText = Set-TomlFeature $configText 'remote_plugin' $false
foreach ($plugin in @('documents@openai-primary-runtime', 'pdf@openai-primary-runtime', 'spreadsheets@openai-primary-runtime', 'presentations@openai-primary-runtime', 'template-creator@openai-primary-runtime', 'task-tree@llm-task-tree')) {
  $header = [regex]::Escape("[plugins.`"$plugin`"]")
  $configText = [regex]::Replace($configText, "(?ms)(^$header.*?^enabled\s*=\s*)true", '$1false')
}
Write-Utf8 $configPath $configText
Write-Profiles $originalConfigText $codexHome
$savedConfigText = [IO.File]::ReadAllText($configPath)
if (Get-TomlSection $savedConfigText 'mcp_servers.node_repl') {
  Assert-TextMatch $savedConfigText '(?ms)^\[mcp_servers\.node_repl\].*?^enabled\s*=\s*false[ \t]*\r?$' 'The default config did not disable node_repl.'
}
if (Get-TomlSection $savedConfigText 'mcp_servers.task_tree') {
  throw 'The default config still contains the task-tree MCP section.'
}
Assert-TextMatch $savedConfigText '(?m)^plugins\s*=\s*false[ \t]*\r?$' 'The default config did not disable plugins.'
Assert-TextMatch $savedConfigText '(?m)^remote_plugin\s*=\s*false[ \t]*\r?$' 'The default config did not disable remote plugin catalog sync.'

$movedCodex = Move-DeferredSkills (Join-Path $codexHome 'skills') $deferredCodex @('.system')
$movedAgents = Move-DeferredSkills (Join-Path $agentsHome 'skills') $deferredAgents $coreAgentSkills
$manifest = [ordered]@{
  schemaVersion = 'codex-lazy-capabilities/1'
  createdAt = [DateTime]::UtcNow.ToString('o')
  backupRoot = $backupRoot
  deferredCodexRoot = $deferredCodex
  deferredAgentsRoot = $deferredAgents
  movedCodexSkills = @($movedCodex)
  movedAgentSkills = @($movedAgents)
}
Write-Utf8 (Join-Path $backupRoot 'MANIFEST.json') ($manifest | ConvertTo-Json -Depth 8)
Write-Host "Applied lazy capability loading. Backup: $backupRoot"
Write-Host "Profiles: task-tree, browser, full-tools, documents, pdf, spreadsheets, presentations, template-creator"
