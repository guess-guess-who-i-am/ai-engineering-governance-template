$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-EmptyResult {
  [Console]::Out.Write("{}")
  exit 0
}

function Get-QueryTokens {
  param([string]$Text, [string[]]$StopTokens)
  $tokens = [Collections.Generic.List[string]]::new()
  foreach ($match in [regex]::Matches($Text.ToLowerInvariant(), "[a-z][a-z0-9_-]{1,}|\d+")) {
    if ($match.Value.Length -ge 2) { $tokens.Add($match.Value) }
  }
  foreach ($run in [regex]::Matches($Text, "[\u4e00-\u9fff]+")) {
    $value = $run.Value
    for ($index = 0; $index -lt $value.Length; $index++) {
      if ($index + 1 -lt $value.Length) { $tokens.Add($value.Substring($index, 2)) }
      if ($index + 2 -lt $value.Length) { $tokens.Add($value.Substring($index, 3)) }
    }
  }
  return @($tokens | Where-Object { $StopTokens -notcontains $_ } | Select-Object -Unique | Select-Object -First 80)
}

function Get-LocalSkillEntries {
  param([string]$StartDirectory)
  if (-not $StartDirectory -or -not (Test-Path -LiteralPath $StartDirectory -PathType Container)) { return @() }
  $current = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($StartDirectory))
  $roots = [Collections.Generic.List[string]]::new()
  while ($null -ne $current) {
    foreach ($relative in @("skills", ".agents\skills", "llm-task-tree\skills")) {
      $candidate = Join-Path $current.FullName $relative
      if (Test-Path -LiteralPath $candidate -PathType Container) { $roots.Add($candidate) }
    }
    $current = $current.Parent
  }
  $entries = [Collections.Generic.List[object]]::new()
  foreach ($root in ($roots | Select-Object -Unique)) {
    foreach ($file in Get-ChildItem -LiteralPath $root -Filter "SKILL.md" -Recurse -File -ErrorAction SilentlyContinue) {
      $text = [IO.File]::ReadAllText($file.FullName)
      $nameMatch = [regex]::Match($text, '(?m)^name:\s*["'']?([^\r\n"'']+)')
      $descMatch = [regex]::Match($text, "(?m)^description:\s*(.+)$")
      $name = if ($nameMatch.Success) { $nameMatch.Groups[1].Value.Trim() } else { $file.Directory.Name }
      $description = if ($descMatch.Success) { ($descMatch.Groups[1].Value.Trim() -replace "\s+", " ").Trim('"').Trim("'") } else { "" }
      if (-not $name -or -not $description) { continue }
      $entries.Add([pscustomobject]@{
        id = "project:$($name.ToLowerInvariant())"
        name = $name
        description = $description.Substring(0, [Math]::Min(280, $description.Length))
        keywords = @($name -split "[-_\s]+")
        path = $file.FullName
        source = "project"
        rank = 0
      })
    }
  }
  return @($entries)
}

function Get-AliasRules {
  param([string]$CodexHome)
  $rulesPath = Join-Path $CodexHome "skill-registry\routing-rules.json"
  if (-not (Test-Path -LiteralPath $rulesPath -PathType Leaf)) { return @{} }
  $raw = [IO.File]::ReadAllText($rulesPath, $utf8)
  $document = $raw | ConvertFrom-Json
  $rules = @{}
  foreach ($property in $document.PSObject.Properties) {
    $rules[$property.Name.ToLowerInvariant()] = @($property.Value | ForEach-Object { ([string]$_).ToLowerInvariant() })
  }
  return $rules
}

function Get-PreferredSkills {
  param([object[]]$Skills)
  $preferred = [Collections.Generic.List[object]]::new()
  foreach ($group in ($Skills | Group-Object { ([string]$_.name).ToLowerInvariant() })) {
    $preferred.Add(($group.Group | Sort-Object @{Expression={ [int]($_.rank) }; Ascending=$true}, @{Expression={ [int]($_.path.Length) }; Ascending=$true} | Select-Object -First 1))
  }
  return @($preferred)
}

function Test-ExactSkillName {
  param([string]$Query, [string]$Name)
  if (-not $Name -or $Name.Length -lt 3) { return $false }
  $pattern = "(?<![a-z0-9])" + [regex]::Escape($Name) + "(?![a-z0-9])"
  return [regex]::IsMatch($Query, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function Get-Score {
  param([object]$Skill, [string[]]$Tokens, [string]$Query, [hashtable]$Aliases)
  $name = ([string]$Skill.name).ToLowerInvariant()
  $haystack = (([string]$Skill.name) + " " + ([string]$Skill.description) + " " + ((@($Skill.keywords) -join " "))).ToLowerInvariant()
  $score = 0
  $matches = [Collections.Generic.List[string]]::new()
  foreach ($token in $Tokens) {
    if ($haystack.Contains($token)) {
      $score += if ($token.Length -ge 4) { 3 } else { 1 }
      if ($name.Contains($token)) { $score += if ($token.Length -ge 4) { 6 } else { 2 } }
      if ($matches.Count -lt 3) { $matches.Add($token) }
    }
  }
  if (Test-ExactSkillName -Query $Query -Name $name) { $score += 24; $matches.Add("exact name") }
  if ($Aliases.ContainsKey($name)) {
    foreach ($alias in $Aliases[$name]) {
      if ($Query.Contains($alias.ToLowerInvariant())) {
        $score += 12
        if ($matches.Count -lt 3) { $matches.Add($alias) }
      }
    }
  }
  return [pscustomobject]@{ Skill = $Skill; Score = $score; Matches = @($matches | Select-Object -Unique | Select-Object -First 3) }
}

function Get-ExternalSkillScores {
  param(
    [string]$IndexPath,
    [string[]]$Tokens,
    [string]$Query,
    [hashtable]$Aliases,
    [hashtable]$ExcludedNames
  )
  if (-not (Test-Path -LiteralPath $IndexPath -PathType Leaf)) { return @() }
  $bestByName = @{}
  $patterns = [Collections.Generic.List[string]]::new()
  foreach ($token in @($Tokens | Where-Object { $_.Length -ge 3 } | Sort-Object Length -Descending | Select-Object -Unique -First 16)) {
    if ($token) { $patterns.Add($token) }
  }
  foreach ($entry in $Aliases.GetEnumerator()) {
    foreach ($alias in @($entry.Value)) {
      if ($alias -and $Query.Contains($alias.ToLowerInvariant())) {
        $patterns.Add([string]$entry.Key)
        break
      }
    }
  }

  $candidateLines = $null
  $rgCommand = Get-Command rg -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($patterns.Count -eq 0) { return @() }
  if ($rgCommand) {
    $rgArgs = [Collections.Generic.List[string]]::new()
    foreach ($argument in @("--ignore-case", "--fixed-strings", "--no-heading", "--color", "never", "--max-count", "300")) { $rgArgs.Add($argument) }
    foreach ($pattern in @($patterns | Select-Object -Unique)) {
      $rgArgs.Add("-e")
      $rgArgs.Add($pattern)
    }
    $rgArgs.Add("--")
    $rgArgs.Add($IndexPath)
    $candidateLines = @(& $rgCommand.Source @rgArgs 2>$null)
    if ($LASTEXITCODE -notin @(0, 1)) { $candidateLines = $null }
  }

  if ($null -eq $candidateLines) {
    $candidateLines = [Collections.Generic.List[string]]::new()
    $reader = New-Object IO.StreamReader($IndexPath, $utf8, $true)
    try {
      while (-not $reader.EndOfStream -and $candidateLines.Count -lt 300) {
        $line = $reader.ReadLine()
        $lower = $line.ToLowerInvariant()
        if (@($patterns | Where-Object { $lower.Contains($_.ToLowerInvariant()) }).Count) { $candidateLines.Add($line) }
      }
    } finally {
      $reader.Dispose()
    }
  }

  foreach ($line in $candidateLines) {
    if (-not $line -or $line[0] -eq '#') { continue }
    $fields = $line.Split([char]9)
    if ($fields.Count -lt 8) { continue }
    $name = $fields[0]
    $normalizedName = $name.ToLowerInvariant()
    if ($ExcludedNames.ContainsKey($normalizedName)) { continue }
    $haystack = (($fields[0..5] -join " ") + " " + $fields[7]).ToLowerInvariant()
    $score = 0
    $matches = [Collections.Generic.List[string]]::new()
    foreach ($token in $Tokens) {
      if ($haystack.Contains($token)) {
        $score += if ($token.Length -ge 4) { 3 } else { 1 }
        if ($normalizedName.Contains($token)) { $score += if ($token.Length -ge 4) { 6 } else { 2 } }
        if ($matches.Count -lt 3) { $matches.Add($token) }
      }
    }
    if (Test-ExactSkillName -Query $Query -Name $normalizedName) {
      $score += 24
      if ($matches.Count -lt 3) { $matches.Add("exact name") }
    }
    if ($Aliases.ContainsKey($normalizedName)) {
      foreach ($alias in $Aliases[$normalizedName]) {
        if ($Query.Contains($alias.ToLowerInvariant())) {
          $score += 12
          if ($matches.Count -lt 3) { $matches.Add($alias) }
        }
      }
    }
    if ($score -le 0) { continue }
    if (-not (Test-Path -LiteralPath $fields[6] -PathType Leaf)) { continue }
    $skill = [pscustomobject]@{
      id = "external:$normalizedName"
      name = $name
      description = if ($fields[1]) { $fields[1] } elseif ($fields[2]) { $fields[2] } else { $fields[3] }
      keywords = @($fields[4], $fields[5], $fields[7])
      path = $fields[6]
      source = "external-catalog"
      rank = 100
    }
    $candidate = [pscustomobject]@{ Skill = $skill; Score = $score; Matches = @($matches | Select-Object -Unique | Select-Object -First 3) }
    if (-not $bestByName.ContainsKey($normalizedName) -or $score -gt [int]$bestByName[$normalizedName].Score) {
      $bestByName[$normalizedName] = $candidate
    }
  }
  return @($bestByName.Values)
}

try {
  $inputText = [Console]::In.ReadToEnd()
  if (-not $inputText) { Write-EmptyResult }
  $hookInput = $inputText | ConvertFrom-Json
  if ([string]$hookInput.hook_event_name -ne "UserPromptSubmit") { Write-EmptyResult }
  $prompt = @([string]$hookInput.prompt, [string]$hookInput.user_prompt, [string]$hookInput.message, [string]$hookInput.text) | Where-Object { $_ } | Select-Object -First 1
  if (-not $prompt) { Write-EmptyResult }

  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
  $registryPath = Join-Path $codexHome "skill-registry\skills-index.json"
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { Write-EmptyResult }
  $registry = ([IO.File]::ReadAllText($registryPath, $utf8)) | ConvertFrom-Json
  $skills = @($registry.skills)
  $query = ([string]$prompt).ToLowerInvariant()
  $rcaPath = @(
    (Join-Path $codexHome "skills\root-cause-analysis\SKILL.md"),
    (Join-Path $env:USERPROFILE ".agents\skills\root-cause-analysis\SKILL.md"),
    "D:\Codex\desktop\skills\root-cause-analysis\SKILL.md"
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  $rcaIntent = $query -match "根因分析|为什么失败|第一处分歧|实验效果不好|结果异常|反复失败|跑不通|root[ -]cause|why\s+(?:did\s+it\s+)?fail|unexpected failure"
  if ($rcaPath -and $rcaIntent) {
    $skills += [pscustomobject]@{
      id = "automatic:root-cause-analysis"
      name = "root-cause-analysis"
      description = "Evidence-first RCA for unexpected Agent, tool, test, build, and experiment failures; confirm only with a unique passing minimal replay."
      keywords = @("root", "cause", "failure", "diagnosis", "根因", "失败", "分歧")
      path = $rcaPath
      source = "automatic"
      rank = -10
    }
  }
  $skills = Get-PreferredSkills -Skills $skills
  if (-not $skills.Count) { Write-EmptyResult }

  $aliases = Get-AliasRules -CodexHome $codexHome
  $stopTokens = @($aliases["_stopTokens"])
  $aliases.Remove("_stopTokens")
  $tokens = Get-QueryTokens -Text $query -StopTokens $stopTokens
  $knownNames = @{}
  foreach ($skill in $skills) { $knownNames[([string]$skill.name).ToLowerInvariant()] = $true }
  $localAliasMatch = $false
  foreach ($entry in $aliases.GetEnumerator()) {
    if (-not $knownNames.ContainsKey(([string]$entry.Key).ToLowerInvariant())) { continue }
    foreach ($alias in @($entry.Value)) {
      if ($alias -and $query.Contains($alias.ToLowerInvariant())) {
        $localAliasMatch = $true
        break
      }
    }
    if ($localAliasMatch) { break }
  }
  $allScored = [Collections.Generic.List[object]]::new()
  foreach ($item in @($skills | ForEach-Object { Get-Score -Skill $_ -Tokens $tokens -Query $query -Aliases $aliases } | Where-Object { $_.Score -gt 0 })) {
    $allScored.Add($item)
  }
  $externalIndexProperty = $registry.PSObject.Properties["externalIndexPath"]
  $externalIndexPath = if ($externalIndexProperty) { [string]$externalIndexProperty.Value } else { Join-Path $codexHome "skill-registry\external-skills.tsv" }
  if ($externalIndexPath -and -not $localAliasMatch) {
    foreach ($item in @(Get-ExternalSkillScores -IndexPath $externalIndexPath -Tokens $tokens -Query $query -Aliases $aliases -ExcludedNames $knownNames)) {
      $allScored.Add($item)
    }
  }
  $deferredIndexProperty = $registry.PSObject.Properties["deferredIndexPath"]
  $deferredIndexPath = if ($deferredIndexProperty) { [string]$deferredIndexProperty.Value } else { Join-Path $codexHome "skill-registry\deferred-skills.tsv" }
  if ($deferredIndexPath -and -not $localAliasMatch) {
    foreach ($item in @(Get-ExternalSkillScores -IndexPath $deferredIndexPath -Tokens $tokens -Query $query -Aliases $aliases -ExcludedNames $knownNames)) {
      $allScored.Add($item)
    }
  }
  $scored = @($allScored | Sort-Object -Property @{Expression="Score";Descending=$true}, @{Expression={ [int]$_.Skill.rank };Ascending=$true}, @{Expression={ [string]$_.Skill.name };Ascending=$true})
  if (-not $scored.Count) { Write-EmptyResult }
  $topScore = [int]$scored[0].Score
  if ($topScore -lt 6) { Write-EmptyResult }
  $minimum = [Math]::Max(6, [Math]::Floor($topScore * 0.55))
  $selected = @($scored | Where-Object { $_.Score -ge $minimum } | Select-Object -First 4)
  if (-not $selected.Count) { Write-EmptyResult }

  $lines = [Collections.Generic.List[string]]::new()
  $lines.Add("[CODEX_SKILL_ROUTER_V1]")
  $lines.Add("Assistive routing only: read a full SKILL.md only when it directly applies to the latest request; do not load the whole Skill catalog.")
  $lines.Add("Candidates:")
  foreach ($item in $selected) {
    $skill = $item.Skill
    $reason = if (@($item.Matches).Count) { (@($item.Matches) -join ", ") } else { "description match" }
    $description = (([string]$skill.description) -replace "\s+", " ").Trim()
    $lines.Add("- $($skill.name) [score=$($item.Score); match=$reason]")
    $lines.Add("  $description")
    $lines.Add("  Read: $($skill.path)")
  }
  $lines.Add("If none is genuinely relevant, ignore this list and continue without a specialized Skill.")

  $payload = [ordered]@{ hookSpecificOutput = [ordered]@{ hookEventName = "UserPromptSubmit"; additionalContext = ($lines -join "`n") } }
  [Console]::Out.Write(($payload | ConvertTo-Json -Depth 6 -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine("Skill router skipped: $($_.Exception.Message)")
  Write-EmptyResult
}
