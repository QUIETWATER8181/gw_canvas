# Reset the probe draft (never touches the real %APPDATA% data) to a known scene.
# Usage: powershell -NoProfile -File scripts/reset-probe-scene.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$home_ = Join-Path $root '_testhome\drafts-test'
$reg = Join-Path $home_ 'drafts.json'
if (-not (Test-Path $reg)) { throw "no drafts.json at $reg" }
$active = (Get-Content $reg -Raw -Encoding UTF8 | ConvertFrom-Json).activeId
$dir = Join-Path $home_ "drafts\$active"
if (-not (Test-Path $dir)) { throw "no active draft dir $dir" }

Copy-Item (Join-Path $root 'scripts\fixture-probe-scene.json') (Join-Path $dir 'scene.json') -Force
$assets = Join-Path $dir 'assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }
$srcDir = Join-Path $home_ 'drafts\d-mw08o61q5u\assets'
foreach ($f in @('vo-agent.wav', '10.31.2.png')) {
  $src = Join-Path $srcDir $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $assets $f) -Force }
}
Write-Output "reset $dir"
