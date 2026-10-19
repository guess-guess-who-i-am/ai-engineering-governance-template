[CmdletBinding()]
param(
  [string]$UserHome = $env:USERPROFILE,
  [string]$LibraryRoot = $env:CODEX_EXTERNAL_SKILL_ROOT,
  [string]$RuntimeRoot,
  [switch]$Check
)
$ErrorActionPreference = 'Stop'
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $UserHome '.codex/tools/graph-tool-call-windows' }
$python = Join-Path $RuntimeRoot 'Scripts/python.exe'
$installer = Join-Path $PSScriptRoot 'install-codex-profile-windows.mjs'
if (-not $Check) {
  $uv = (Get-Command uv -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath $python)) {
    $nativePython = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python311/python.exe'
    if (-not (Test-Path -LiteralPath $nativePython)) { throw 'Install native CPython 3.11 and uv first; MSYS Python is not the supported runtime.' }
    & $uv venv --python $nativePython $RuntimeRoot
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated Python runtime.' }
  }
  & $uv pip install --python $python -r (Join-Path $PSScriptRoot '../codex-profile/windows/requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Graph dependency installation failed.' }
  $modelCache = Join-Path (Split-Path -Parent $RuntimeRoot) 'embedding-models'
  & $python -c 'import sys; from sentence_transformers import SentenceTransformer; SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", device="cpu", cache_folder=sys.argv[1]); print("Local multilingual model is ready")' $modelCache
  if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare the local multilingual embedding model.' }
}
$arguments = @($installer, '--home', $UserHome, '--python', $python, '--json')
if ($LibraryRoot) { $arguments += @('--library-root', $LibraryRoot) }
if ($Check) { $arguments += '--check' } else { $arguments += '--prepare' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Windows profile installation or verification failed.' }
