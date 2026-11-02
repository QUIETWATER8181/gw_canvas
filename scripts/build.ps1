# Build the Electron app with automatic retry.
#
# electron-vite build hangs at "transforming..." roughly half the time on this
# machine (node burns 1-2s CPU then waits forever, usually with two esbuild
# children alive). There is no clean way to unstick it, so: timeout, kill, retry.
#
# Usage: powershell -File scripts/build.ps1
#        powershell -File scripts/build.ps1 -Tries 6 -TimeoutSec 90
#
# NOTE: keep this file ASCII-only. Windows PowerShell reads BOM-less UTF-8 as
# ANSI, which corrupts non-ASCII text and breaks the parser.

param(
  [int]$Tries = 4,
  [int]$TimeoutSec = 75
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = 'C:\Users\tiann\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$log = Join-Path $root 'build.log'
$errLog = Join-Path $root 'build.err.log'

for ($i = 1; $i -le $Tries; $i++) {
  Get-Process node, esbuild -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1500
  Remove-Item (Join-Path $root 'out') -Recurse -Force -ErrorAction SilentlyContinue

  $started = Get-Date
  $p = Start-Process -FilePath $node -ArgumentList 'node_modules\electron-vite\bin\electron-vite.js', 'build' -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError $errLog

  $exited = $p.WaitForExit($TimeoutSec * 1000)

  if (-not $exited) {
    Write-Output "[build] try $i timed out after ${TimeoutSec}s, killing and retrying"
    try { $p.Kill($true) } catch { }
    Get-Process node, esbuild -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    continue
  }

  # ExitCode is unreliable through Start-Process redirection here, so judge by
  # the artifact we actually care about: out/renderer/index.html must be fresh.
  $html = Join-Path $root 'out\renderer\index.html'
  $fresh = (Test-Path $html) -and ((Get-Item $html).LastWriteTime -gt $started)

  if ($fresh) {
    $secs = ((Get-Date) - $started).TotalSeconds.ToString('0.0')
    Write-Output "[build] ok on try $i (${secs}s)"
    Remove-Item $log, $errLog -Force -ErrorAction SilentlyContinue
    exit 0
  }

  Write-Output "[build] try $i produced no output"
  Get-Content $errLog -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 12
  Get-Content $log -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 6
}

Write-Output "[build] gave up after $Tries tries"
exit 1
