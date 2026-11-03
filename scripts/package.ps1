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
  # 不要用管道接 electron-builder 的输出：它派生的子进程会一直握着 stdout，
  # 管道永不结束，脚本就永远卡在最后一行（而工作其实早就做完了）。
  Remove-Item '_eb.log', '_eb.err.log' -Force -ErrorAction SilentlyContinue
  $eb = Start-Process -FilePath $node `
    -ArgumentList 'node_modules\electron-builder\cli.js', '--win', '--dir' `
    -RedirectStandardOutput (Join-Path $root '_eb.log') `
    -RedirectStandardError (Join-Path $root '_eb.err.log') `
    -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes(8)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path 'dist\win-unpacked\Gewu.exe') { break }
    if ($eb.HasExited) { break }
    Start-Sleep -Seconds 3
  }
  if (-not (Test-Path 'dist\win-unpacked\Gewu.exe')) {
    Get-Content '_eb.log' -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 5
    throw 'Gewu.exe not produced'
  }
  # exe 先出现，asar 还没写完；等进程自己退出，最多再等 3 分钟
  $eb.WaitForExit(180000) | Out-Null
  if (-not $eb.HasExited) { $eb | Stop-Process -Force -ErrorAction SilentlyContinue }
  Get-Content '_eb.log' -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 3
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
