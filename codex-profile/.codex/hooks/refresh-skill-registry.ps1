$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-EmptyResult {
  [Console]::Out.Write("{}")
  exit 0
}

function Get-FrontMatterValue {
  param([string]$Text, [string]$Name)
  $match = [regex]::Match($Text, "(?m)^$([regex]::Escape($Name)):\s*(.+)$")
  if (-not $match.Success) { return "" }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Get-SkillDescription {
  param([string]$Text)
  $description = Get-FrontMatterValue -Text $Text -Name "description"
  if (-not $description) { return "" }
  return (($description -replace "\s+", " ").Trim())
}

function Get-SkillName {
  param([string]$Text, [string]$FilePath)
  $name = Get-FrontMatterValue -Text $Text -Name "name"
  if ($name) { return $name }
  $heading = [regex]::Match($Text, "(?m)^#\s+(.+?)\s*$")
  if ($heading.Success) { return $heading.Groups[1].Value.Trim() }
  return [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($FilePath))
}

function Get-Keywords {
  param([string]$Name, [string]$Description)
  $parts = @($Name -split "[-_\s]+")
  $parts += [regex]::Matches($Description.ToLowerInvariant(), "[a-z][a-z0-9-]{2,}") | ForEach-Object { $_.Value }
  return @($parts | Where-Object { $_ -and $_.Length -ge 3 } | Select-Object -Unique | Select-Object -First 24)
}

function Get-Sha256 {
  param([string]$FilePath)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return (($sha.ComputeHash([IO.File]::ReadAllBytes($FilePath)) | ForEach-Object { $_.ToString("x2") }) -join "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function ConvertTo-IndexField {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return ((([string]$Value) -replace "[`r`n`t]+", " ") -replace "\s+", " ").Trim()
}

function Get-ExternalSkillConfiguration {
  $catalogPath = if ($env:CODEX_EXTERNAL_SKILL_CATALOG) {
    [IO.Path]::GetFullPath($env:CODEX_EXTERNAL_SKILL_CATALOG)
  } else {
    "E:\skills\_catalog_cn.json"
  }
  $rootPath = if ($env:CODEX_EXTERNAL_SKILL_ROOT) {
    [IO.Path]::GetFullPath($env:CODEX_EXTERNAL_SKILL_ROOT)
  } elseif ($env:CODEX_EXTERNAL_SKILL_CATALOG) {
    [IO.Path]::GetDirectoryName($catalogPath)
  } else {
    "E:\skills"
  }
  return [pscustomobject]@{ CatalogPath = $catalogPath; RootPath = $rootPath }
}

function Update-ExternalSkillIndex {
  param([string]$RegistryDirectory)

  $configuration = Get-ExternalSkillConfiguration
  $catalogPath = $configuration.CatalogPath
  $rootPath = $configuration.RootPath
  $indexPath = Join-Path $RegistryDirectory "external-skills.tsv"
  $manifestPath = Join-Path $RegistryDirectory "external-skills-manifest.json"
  if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf) -or -not (Test-Path -LiteralPath $rootPath -PathType Container)) {
    return $null
  }

  $catalogFile = Get-Item -LiteralPath $catalogPath
  $sourceLastWriteUtc = $catalogFile.LastWriteTimeUtc.ToString("o")
  $isCurrent = $false
  if ((Test-Path -LiteralPath $indexPath -PathType Leaf) -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    try {
      $manifest = [IO.File]::ReadAllText($manifestPath, $utf8) | ConvertFrom-Json
      $isCurrent = (
        ([string]$manifest.schemaVersion -eq "codex-external-skill-index/2") -and
        ([string]$manifest.catalogPath -eq $catalogPath) -and
        ([string]$manifest.rootPath -eq $rootPath) -and
        ([int64]$manifest.sourceLength -eq [int64]$catalogFile.Length) -and
        ([string]$manifest.sourceLastWriteUtc -eq $sourceLastWriteUtc)
      )
    } catch {
      $isCurrent = $false
    }
  }
  if ($isCurrent) { return $manifest }

  $catalog = [IO.File]::ReadAllText($catalogPath, $utf8) | ConvertFrom-Json
  $tempIndexPath = "$indexPath.tmp"
  $writer = New-Object IO.StreamWriter($tempIndexPath, $false, $utf8)
  $count = 0
  $missingCount = 0
  try {
    $writer.WriteLine("# codex-external-skill-index/2")
    foreach ($skill in @($catalog.skills)) {
      $name = ConvertTo-IndexField $skill.name
      $directory = ConvertTo-IndexField $skill.dir
      if (-not $name -or -not $directory) { continue }
      $skillPath = Join-Path (Join-Path $rootPath $directory) "SKILL.md"
      if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
        $missingCount++
        continue
      }
      $fields = @(
        $name,
        (ConvertTo-IndexField $skill.description),
        (ConvertTo-IndexField $skill.problem_cn),
        (ConvertTo-IndexField $skill.when_cn),
        (ConvertTo-IndexField $skill.c1),
        (ConvertTo-IndexField $skill.c2),
        (ConvertTo-IndexField $skillPath),
        (ConvertTo-IndexField $skill.key)
      )
      $writer.WriteLine(($fields -join "`t"))
      $count++
    }
  } finally {
    $writer.Dispose()
  }
  Move-Item -LiteralPath $tempIndexPath -Destination $indexPath -Force

  $manifest = [ordered]@{
    schemaVersion = "codex-external-skill-index/2"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    catalogPath = $catalogPath
    rootPath = $rootPath
    sourceLength = [int64]$catalogFile.Length
    sourceLastWriteUtc = $sourceLastWriteUtc
    skillCount = $count
    missingSkillCount = $missingCount
    indexPath = $indexPath
  }
  $tempManifestPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($tempManifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
  Move-Item -LiteralPath $tempManifestPath -Destination $manifestPath -Force
  return [pscustomobject]$manifest
}

function Update-DeferredSkillIndex {
  param([string]$RegistryDirectory, [string]$CodexHome)

  $roots = @(
    (Join-Path $CodexHome "deferred-skills\codex"),
    (Join-Path $env:USERPROFILE ".agents\deferred-skills")
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
  $indexPath = Join-Path $RegistryDirectory "deferred-skills.tsv"
  $manifestPath = Join-Path $RegistryDirectory "deferred-skills-manifest.json"
  $tempIndexPath = "$indexPath.tmp"
  $writer = New-Object IO.StreamWriter($tempIndexPath, $false, $utf8)
  $count = 0
  try {
    $writer.WriteLine("# codex-deferred-skill-index/1")
    foreach ($root in $roots) {
      foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter "SKILL.md" -Recurse -File -ErrorAction SilentlyContinue)) {
        $text = [IO.File]::ReadAllText($file.FullName)
        $name = ConvertTo-IndexField (Get-SkillName -Text $text -FilePath $file.FullName)
        $description = ConvertTo-IndexField (Get-SkillDescription -Text $text)
        if (-not $name -or -not $description) { continue }
        $fields = @($name, $description, "", "", "", "", (ConvertTo-IndexField $file.FullName), "deferred")
        $writer.WriteLine(($fields -join "`t"))
        $count++
      }
    }
  } finally {
    $writer.Dispose()
  }
  Move-Item -LiteralPath $tempIndexPath -Destination $indexPath -Force
  $manifest = [ordered]@{
    schemaVersion = "codex-deferred-skill-index/1"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    roots = @($roots)
    skillCount = $count
    indexPath = $indexPath
  }
  $tempManifestPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($tempManifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
  Move-Item -LiteralPath $tempManifestPath -Destination $manifestPath -Force
  return [pscustomobject]$manifest
}

try {
  $inputText = [Console]::In.ReadToEnd()
  $hookInput = if ($inputText) { try { $inputText | ConvertFrom-Json } catch { $null } } else { $null }
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
  $registryDir = Join-Path $codexHome "skill-registry"
  $registryPath = Join-Path $registryDir "skills-index.json"
  New-Item -ItemType Directory -Path $registryDir -Force | Out-Null
  $externalManifest = $null
  try {
    $externalManifest = Update-ExternalSkillIndex -RegistryDirectory $registryDir
  } catch {
    [Console]::Error.WriteLine("External Skill index refresh skipped: $($_.Exception.Message)")
  }
  $deferredManifest = Update-DeferredSkillIndex -RegistryDirectory $registryDir -CodexHome $codexHome

  $roots = @(
    [pscustomobject]@{ source = "codex"; rank = 10; path = (Join-Path $codexHome "skills") },
    [pscustomobject]@{ source = "agents"; rank = 20; path = (Join-Path $env:USERPROFILE ".agents\skills") },
    [pscustomobject]@{ source = "orchestra"; rank = 30; path = (Join-Path $env:USERPROFILE ".orchestra\skills") }
  )
  $projectCwd = [string]$hookInput.cwd
  if ($projectCwd -and (Test-Path -LiteralPath $projectCwd -PathType Container)) {
    $roots += @(
      [pscustomobject]@{ source = "project"; rank = 0; path = (Join-Path $projectCwd "skills") },
      [pscustomobject]@{ source = "project"; rank = 0; path = (Join-Path $projectCwd ".agents\skills") },
      [pscustomobject]@{ source = "project"; rank = 0; path = (Join-Path $projectCwd "llm-task-tree\skills") }
    )
  }
  $roots = @($roots | Where-Object { Test-Path -LiteralPath $_.path -PathType Container } | Group-Object path | ForEach-Object { $_.Group | Select-Object -First 1 })

  $skills = [Collections.Generic.List[object]]::new()
  foreach ($root in $roots) {
    foreach ($file in Get-ChildItem -LiteralPath $root.path -Filter "SKILL.md" -Recurse -File -ErrorAction SilentlyContinue) {
      $text = [IO.File]::ReadAllText($file.FullName)
      $name = (Get-SkillName -Text $text -FilePath $file.FullName).Trim()
      $description = Get-SkillDescription -Text $text
      if (-not $name -or -not $description) { continue }
      $hash = Get-Sha256 -FilePath $file.FullName
      $skills.Add([ordered]@{
        id = "$($root.source):$($name.ToLowerInvariant())"
        name = $name
        description = $description.Substring(0, [Math]::Min(280, $description.Length))
        keywords = @(Get-Keywords -Name $name -Description $description)
        path = $file.FullName
        source = $root.source
        rank = [int]$root.rank
        bytes = [int64]$file.Length
        sha256 = $hash
      })
    }
  }

  $payload = [ordered]@{
    schemaVersion = "codex-skill-registry/2"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    roots = @($roots | ForEach-Object { [ordered]@{ source = $_.source; rank = [int]$_.rank; path = $_.path } })
    skillCount = $skills.Count
    externalSkillCount = if ($externalManifest) { [int]$externalManifest.skillCount } else { 0 }
    externalIndexPath = if ($externalManifest) { [string]$externalManifest.indexPath } else { "" }
    deferredIndexPath = if ($deferredManifest) { [string]$deferredManifest.indexPath } else { "" }
    skills = @($skills)
  }
  $tempPath = "$registryPath.tmp"
  [IO.File]::WriteAllText($tempPath, ($payload | ConvertTo-Json -Depth 8), $utf8)
  Move-Item -LiteralPath $tempPath -Destination $registryPath -Force
  Write-EmptyResult
} catch {
  [Console]::Error.WriteLine("Skill registry refresh skipped: $($_.Exception.Message)")
  Write-EmptyResult
}
