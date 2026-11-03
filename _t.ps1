$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$ebLog = Join-Path $root '_eb.log'
Write-Host "root=[$root] ebLog=[$ebLog]"
