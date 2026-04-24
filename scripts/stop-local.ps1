$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$escapedProjectRoot = [WildcardPattern]::Escape($projectRoot)

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*$escapedProjectRoot*" -and
    (
      $_.CommandLine -like "*next*dev*" -or
      $_.CommandLine -like "*npm*run*dev*" -or
      $_.CommandLine -like "*.next*dev*build*"
    )
  }

if (-not $processes) {
  Write-Host "No hay servidor local de People corriendo."
  exit 0
}

foreach ($process in $processes) {
  Write-Host "Deteniendo proceso $($process.ProcessId) ..."
  Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
}

Write-Host "Servidor local de People detenido."
