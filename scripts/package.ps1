# Package the app into dist/win-unpacked (portable folder, no installer).
#
# Why not a single electron-builder call:
#   1) electron-builder always strips node_modules from extraResources, so
#      vendor/dsh-runtime arrives with 6 files and the agent cannot start.
#   2) Downloading the Electron zip stalls at 0 bytes on this network, so we
#      point electronDist at the copy already inside node_modules.
# Both are handled here: build -> electron-builder --dir -> robocopy runtime.

param(
  [switch]$SkipBuild,
  [switch]$SkipElectron
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = 'C:\Users\tiann\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

if (-not $SkipBuild) {
  Write-Host '[pkg] building renderer + main'
  & "$PSScriptRoot\build.ps1"
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" }
}

if (-not $SkipElectron) {
  Write-Host '[pkg] electron-builder --win --dir'
  if (Test-Path dist) { Remove-Item dist -Recurse -Force }
  & $node node_modules\electron-builder\cli.js --win --dir 2>&1 | Select-Object -Last 4
  if (-not (Test-Path 'dist\win-unpacked\Gewu.exe')) { throw 'Gewu.exe not produced' }
}

$src = 'vendor\dsh-runtime'
$dst = 'dist\win-unpacked\resources\dsh-runtime'
$srcCount = (Get-ChildItem $src -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
$dstCount = 0
if (Test-Path $dst) { $dstCount = (Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count }

if ($dstCount -lt $srcCount) {
  Write-Host "[pkg] copying dsh-runtime ($srcCount files)"
  $null = robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /MT:8
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
} else {
  Write-Host "[pkg] dsh-runtime already complete ($dstCount files)"
}

$marker = Join-Path $dst 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path $marker)) { throw "dsh runtime incomplete: $marker missing" }

$s = Get-ChildItem dist -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
Write-Host ("[pkg] ok  {0} files  {1:N0} MB" -f $s.Count, ($s.Sum / 1MB))
Write-Host ("[pkg] exe: {0}" -f (Resolve-Path 'dist\win-unpacked\Gewu.exe'))
