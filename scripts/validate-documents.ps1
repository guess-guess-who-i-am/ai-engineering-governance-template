[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$trackedRaw = & git -C $Root ls-files -z
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate tracked files.' }
$tracked = @($trackedRaw -split "`0" | Where-Object { $_ })
$untrackedRaw = & git -C $Root ls-files --others --exclude-standard -z
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate untracked files.' }
$governedRoots = @('.agents', '.github', 'docs', 'quality', 'requirements', 'scripts', 'site')
$untracked = @($untrackedRaw -split "`0" | Where-Object {
    if (-not $_) { return $false }
    $normalized = $_.Replace('\', '/')
    if ($normalized -notmatch '/') { return $true }
    return ($normalized.Split('/')[0] -in $governedRoots)
})
$repositoryFiles = @($tracked + $untracked | Sort-Object -Unique)
$textExtensions = @('.md', '.json', '.yml', '.yaml', '.html', '.css', '.js', '.mjs', '.ps1')
$decoder = [Text.UTF8Encoding]::new($false, $true)
$mojibakeMarkers = @(
    (-join @([char]0x951F, [char]0x65A4, [char]0x62F7)),
    (-join @([char]0x00EF, [char]0x00BF, [char]0x00BD))
)
$incorrectProductName = -join @([char]0x7A, [char]0x67, [char]0x61, [char]0x69)
$checked = 0
foreach ($relative in $repositoryFiles) {
    $extension = [IO.Path]::GetExtension($relative).ToLowerInvariant()
    if ($extension -notin $textExtensions) { continue }
    $path = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Repository text file is missing: $relative" }
    try { $body = $decoder.GetString([IO.File]::ReadAllBytes($path)) } catch { throw "Repository text is not valid UTF-8: $relative" }
    if ($body.Contains([char]0xFFFD) -or @($mojibakeMarkers | Where-Object { $body.Contains($_) }).Count -gt 0) { throw "Repository text contains replacement or mojibake markers: $relative" }
    if ($body -match "(?i)\b$incorrectProductName\b") { throw "Use the verified product name ZGI, not the common misspelling: $relative" }
    if ($extension -eq '.json') { try { $body | ConvertFrom-Json -Depth 30 -AsHashtable | Out-Null } catch { throw "Invalid JSON: $relative" } }
    if ($extension -eq '.md') {
        $markdown = [regex]::Replace($body, '(?ms)```.*?```', '')
        $markdown = [regex]::Replace($markdown, '`[^`]+`', '')
        foreach ($match in [regex]::Matches($markdown, '(?<!\!)\[[^\]]+\]\((?<target>[^\)]+)\)')) {
            $target = $match.Groups['target'].Value.Trim().Trim('<', '>')
            if ($target -match '^(https?://|mailto:|#)' -or [string]::IsNullOrWhiteSpace($target)) { continue }
            $withoutAnchor = [Uri]::UnescapeDataString(($target -split '#')[0])
            $resolved = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $path) $withoutAnchor))
            $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved)) {
                throw "Broken relative Markdown link in ${relative}: $target"
            }
        }
    }
    $checked++
}

$sitePath = Join-Path $Root 'site/index.html'
if (Test-Path -LiteralPath $sitePath) {
    $html = Get-Content -LiteralPath $sitePath -Raw
    $ids = @([regex]::Matches($html, '\sid="(?<id>[^"]+)"') | ForEach-Object { $_.Groups['id'].Value })
    foreach ($anchor in [regex]::Matches($html, 'href="#(?<id>[^"]+)"')) {
        if ($anchor.Groups['id'].Value -notin $ids) { throw "Broken site anchor '#$($anchor.Groups['id'].Value)'." }
    }
}
Write-Output "Validated encoding, JSON, terminology, and links across $checked repository text files."
