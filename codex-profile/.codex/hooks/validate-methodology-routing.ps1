$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$sourcePath = Join-Path $codexRoot "prompts\global-every-turn.en.md"
$chineseSourcePath = Join-Path $codexRoot "prompts\global-every-turn.zh.md"
$chineseAnchorPath = Join-Path $codexRoot "prompts\global-attention-anchor.zh.md"
$chineseReviewPath = Join-Path $codexRoot "prompts\global-methodology-routing-review.zh.md"
$mapPath = Join-Path $codexRoot "prompts\global-methodology-map.json"
$targetPaths = @{
  alwaysOn = Join-Path $codexRoot "prompts\global-attention-anchor.en.md"
  "method-research-evidence" = Join-Path $env:USERPROFILE ".agents\skills\method-research-evidence\SKILL.md"
  "method-engineering-execution" = Join-Path $env:USERPROFILE ".agents\skills\method-engineering-execution\SKILL.md"
  "method-evaluation-gates" = Join-Path $env:USERPROFILE ".agents\skills\method-evaluation-gates\SKILL.md"
  "method-github-delivery" = Join-Path $env:USERPROFILE ".agents\skills\method-github-delivery\SKILL.md"
  "method-task-tree" = Join-Path $env:USERPROFILE ".agents\skills\method-task-tree\SKILL.md"
}

$errors = [Collections.Generic.List[string]]::new()
foreach ($path in @($sourcePath, $chineseSourcePath, $chineseAnchorPath, $chineseReviewPath, $mapPath) + @($targetPaths.Values)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $errors.Add("Missing file: $path") }
}
if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_) }; exit 1 }

$sourceRules = @([IO.File]::ReadAllLines($sourcePath, $utf8) | Where-Object { $_.StartsWith("- ") })
$chineseSourceRules = @([IO.File]::ReadAllLines($chineseSourcePath, $utf8) | Where-Object { $_.StartsWith("- ") })
$map = [IO.File]::ReadAllText($mapPath, $utf8) | ConvertFrom-Json
if ($sourceRules.Count -ne [int]$map.ruleCount) {
  $errors.Add("Source has $($sourceRules.Count) rules; map declares $($map.ruleCount).")
}
if ($chineseSourceRules.Count -ne [int]$map.ruleCount) {
  $errors.Add("Chinese review source has $($chineseSourceRules.Count) rules; map declares $($map.ruleCount).")
}

$owners = @{}
foreach ($routeProperty in $map.routes.PSObject.Properties) {
  $route = $routeProperty.Name
  if (-not $targetPaths.ContainsKey($route)) { $errors.Add("No target configured for route: $route"); continue }
  $targetLines = @([IO.File]::ReadAllLines($targetPaths[$route], $utf8))
  foreach ($rawId in @($routeProperty.Value)) {
    $id = [int]$rawId
    if ($id -lt 1 -or $id -gt $sourceRules.Count) { $errors.Add("Out-of-range rule $id in $route"); continue }
    if ($owners.ContainsKey($id)) { $errors.Add("Rule $id is duplicated in $($owners[$id]) and $route") } else { $owners[$id] = $route }
    $expected = $sourceRules[$id - 1]
    if ($targetLines -cnotcontains $expected) { $errors.Add("Rule $id is not an exact line in $route target") }
  }
}

for ($id = 1; $id -le $sourceRules.Count; $id++) {
  if (-not $owners.ContainsKey($id)) { $errors.Add("Rule $id has no route") }
}

$chineseAnchorLines = @([IO.File]::ReadAllLines($chineseAnchorPath, $utf8))
foreach ($id in 1..$chineseSourceRules.Count) {
  $appears = $chineseAnchorLines -ccontains $chineseSourceRules[$id - 1]
  $shouldAppear = $owners[$id] -eq "alwaysOn"
  if ($appears -ne $shouldAppear) {
    $errors.Add("Chinese always-on mirror ownership mismatch for rule $id")
  }
}

$chineseReviewRules = @([IO.File]::ReadAllLines($chineseReviewPath, $utf8) | Where-Object { $_.StartsWith("- ") })
if ($chineseReviewRules.Count -ne $chineseSourceRules.Count) {
  $errors.Add("Chinese routed review has $($chineseReviewRules.Count) rules; expected $($chineseSourceRules.Count).")
}
foreach ($id in 1..$chineseSourceRules.Count) {
  $matches = @($chineseReviewRules | Where-Object { $_ -ceq $chineseSourceRules[$id - 1] }).Count
  if ($matches -ne 1) { $errors.Add("Chinese review rule $id appears $matches times; expected exactly once") }
}

foreach ($route in $targetPaths.Keys) {
  $targetLines = @([IO.File]::ReadAllLines($targetPaths[$route], $utf8))
  for ($id = 1; $id -le $sourceRules.Count; $id++) {
    if ($targetLines -ccontains $sourceRules[$id - 1] -and $owners[$id] -ne $route) {
      $errors.Add("Rule $id appears in $route but is owned by $($owners[$id])")
    }
  }
  if ($route -ne "alwaysOn") {
    $targetText = $targetLines -join "`n"
    $nameMatch = [regex]::Match($targetText, "(?m)^name:\s*(.+)$")
    $descriptionMatch = [regex]::Match($targetText, "(?m)^description:\s*(.+)$")
    if (-not $nameMatch.Success -or $nameMatch.Groups[1].Value.Trim() -ne $route) {
      $errors.Add("Skill frontmatter name does not match route: $route")
    }
    if (-not $descriptionMatch.Success -or -not $descriptionMatch.Groups[1].Value.Trim()) {
      $errors.Add("Skill frontmatter description is missing: $route")
    }
  }
}

if ($errors.Count) {
  $errors | ForEach-Object { [Console]::Error.WriteLine($_) }
  exit 1
}

[Console]::Out.WriteLine("PASS: $($sourceRules.Count) English rules are assigned exactly once and preserved verbatim; the Chinese review mirrors also match all source rules exactly once.")
foreach ($routeProperty in $map.routes.PSObject.Properties) {
  [Console]::Out.WriteLine("$($routeProperty.Name): $(@($routeProperty.Value).Count) rules")
}
