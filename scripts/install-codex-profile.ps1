[CmdletBinding()]
param(
  [string]$UserHome = $env:USERPROFILE,
  [switch]$SkipDesktopShortcuts
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$bundleRoot = Join-Path $repositoryRoot "codex-profile"
$sourceCodex = Join-Path $bundleRoot ".codex"
$sourceAgents = Join-Path $bundleRoot ".agents"
$codexHome = Join-Path $UserHome ".codex"
$agentsHome = Join-Path $UserHome ".agents"
$backupRoot = Join-Path $codexHome ("backups\portable-profile\" + (Get-Date -Format "yyyyMMdd-HHmmss"))

if (-not (Test-Path -LiteralPath $sourceCodex -PathType Container)) {
  throw "Portable profile is missing: $sourceCodex"
}

function Get-RelativeFilePath([string]$Root, [string]$File) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $filePath = [IO.Path]::GetFullPath($File)
  if (-not $filePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "File is outside the managed root: $filePath"
  }
  return $filePath.Substring($rootPath.Length)
}

$managedFiles = @(
  Get-ChildItem -LiteralPath $sourceCodex -Recurse -File | ForEach-Object {
    $relativePath = Get-RelativeFilePath $sourceCodex $_.FullName
    [pscustomobject]@{
      Source = $_.FullName
      Destination = Join-Path $codexHome $relativePath
      BackupRelative = Join-Path ".codex" $relativePath
    }
  }
  Get-ChildItem -LiteralPath $sourceAgents -Recurse -File | ForEach-Object {
    $relativePath = Get-RelativeFilePath $sourceAgents $_.FullName
    [pscustomobject]@{
      Source = $_.FullName
      Destination = Join-Path $agentsHome $relativePath
      BackupRelative = Join-Path ".agents" $relativePath
    }
  }
)

$hooksDestination = Join-Path $codexHome "hooks.json"
if (Test-Path -LiteralPath $hooksDestination -PathType Leaf) {
  $hooksBackup = Join-Path $backupRoot ".codex\hooks.json"
  New-Item -ItemType Directory -Path (Split-Path -Parent $hooksBackup) -Force | Out-Null
  Copy-Item -LiteralPath $hooksDestination -Destination $hooksBackup -Force
}

foreach ($entry in $managedFiles) {
  if (Test-Path -LiteralPath $entry.Destination -PathType Leaf) {
    $backup = Join-Path $backupRoot $entry.BackupRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
    Copy-Item -LiteralPath $entry.Destination -Destination $backup -Force
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Destination) -Force | Out-Null
  Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
}

function New-HookCommand([string]$ScriptName) {
  $scriptPath = Join-Path $codexHome ("hooks\" + $ScriptName)
  return 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
}

$routerCommand = New-HookCommand "skill-router.ps1"
$contextCommand = New-HookCommand "context-refresh.ps1"
$registryCommand = New-HookCommand "refresh-skill-registry.ps1"
$hooks = [ordered]@{
  description = "English original-wording reminders plus intent-based Skill routing; the full methodology archive is never injected as one block."
  hooks = [ordered]@{
    UserPromptSubmit = @([ordered]@{
      hooks = @(
        [ordered]@{ type = "command"; command = $routerCommand; commandWindows = $routerCommand; timeout = 5; statusMessage = "Recommending relevant Codex Skills"; additionalContextLimit = 1800 },
        [ordered]@{ type = "command"; command = $contextCommand; commandWindows = $contextCommand; timeout = 5; statusMessage = "Refreshing original-wording reminders and methodology routes"; additionalContextLimit = 8000 }
      )
    })
    SessionStart = @([ordered]@{
      matcher = "^(startup|resume|clear|compact)$"
      hooks = @(
        [ordered]@{ type = "command"; command = $contextCommand; commandWindows = $contextCommand; timeout = 5; statusMessage = "Restoring original-wording reminders and methodology routes"; additionalContextLimit = 8000 },
        [ordered]@{ type = "command"; command = $registryCommand; commandWindows = $registryCommand; timeout = 20; statusMessage = "Refreshing Codex Skill index" }
      )
    })
  }
}
New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
[IO.File]::WriteAllText($hooksDestination, (($hooks | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

if (-not $SkipDesktopShortcuts) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $launcher = Join-Path $codexHome "prompt-publisher\launch-global-prompt-editor.vbs"
  $config = Join-Path $codexHome "prompt-publisher\methodology-targets.json"
  $shell = New-Object -ComObject WScript.Shell
  $editAndPublish = @([char]0x7F16, [char]0x8F91, [char]0x5E76, [char]0x53D1, [char]0x5E03, [char]0x5168, [char]0x5C40) -join ""
  $methodology = @([char]0x65B9, [char]0x6CD5, [char]0x8BBA) -join ""
  foreach ($name in @(($editAndPublish + " Prompt"), ($editAndPublish + $methodology))) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop ($name + ".lnk")))
    $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    $shortcut.Arguments = '"' + $launcher + '" "' + $config + '"'
    $shortcut.WorkingDirectory = Split-Path -Parent $launcher
    $shortcut.Save()
  }
}

$publisher = Join-Path $codexHome "prompt-publisher\publish-methodology.mjs"
$configFile = Join-Path $codexHome "prompt-publisher\methodology-targets.json"
$refresh = Join-Path $codexHome "hooks\refresh-skill-registry.ps1"
$previousUserProfile = $env:USERPROFILE
$previousCodexHome = $env:CODEX_HOME
try {
  $env:USERPROFILE = $UserHome
  $env:CODEX_HOME = $codexHome
  & node $publisher --config $configFile --check
  if ($LASTEXITCODE -ne 0) { throw "Methodology integrity validation failed after installation." }

  $refreshInput = @{ hook_event_name = "SessionStart"; source = "startup"; cwd = $repositoryRoot } | ConvertTo-Json -Compress
  $refreshInput | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $refresh | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Skill registry refresh failed after installation." }
} finally {
  $env:USERPROFILE = $previousUserProfile
  $env:CODEX_HOME = $previousCodexHome
}

Write-Host "Installed the portable Codex profile for $UserHome"
Write-Host "Previous managed files were backed up under $backupRoot"
Write-Host "GitHub and Codex authentication are intentionally not copied; sign in separately on this computer."
