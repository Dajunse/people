$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeRoot = "D:\Projects\Blair\.node-portable\node-v22.12.0-win-x64"
$npmPath = Join-Path $nodeRoot "npm.cmd"

if (-not (Test-Path $npmPath)) {
  throw "No se encontro npm.cmd en $npmPath"
}

$env:PATH = "$nodeRoot;$env:PATH"
Set-Location $projectRoot

Write-Host "Iniciando People en http://localhost:3000 ..."
& $npmPath run dev
