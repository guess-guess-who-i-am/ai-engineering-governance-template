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

try {
  $inputText = [Console]::In.ReadToEnd()
  $hookInput = if ($inputText) { try { $inputText | ConvertFrom-Json } catch { $null } } else { $null }
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
  $registryDir = Join-Path $codexHome "skill-registry"
  $registryPath = Join-Path $registryDir "skills-index.json"
  New-Item -ItemType Directory -Path $registryDir -Force | Out-Null

  $roots = @(
    [pscustomobject]@{ source = "codex"; rank = 10; path = (Join-Path $codexHome "skills") },
    [pscustomobject]@{ source = "agents"; rank = 20; path = (Join-Path $env:USERPROFILE ".agents\skills") },
    [pscustomobject]@{ source = "orchestra"; rank = 30; path = (Join-Path $env:USERPROFILE ".orchestra\skills") },
    [pscustomobject]@{ source = "plugin-cache"; rank = 40; path = "D:\Codex\desktop\plugins\cache" }
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
    schemaVersion = "codex-skill-registry/1"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    roots = @($roots | ForEach-Object { [ordered]@{ source = $_.source; rank = [int]$_.rank; path = $_.path } })
    skillCount = $skills.Count
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
