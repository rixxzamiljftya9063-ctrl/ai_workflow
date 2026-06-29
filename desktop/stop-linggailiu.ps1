$ErrorActionPreference = "SilentlyContinue"
$DesktopDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DesktopDir
$RuntimeDir = Join-Path $RootDir ".desktop-runtime"
$StateFile = Join-Path $RuntimeDir "state.json"

Write-Host "Stopping Linggailiu local services..." -ForegroundColor Yellow

if (Test-Path $StateFile) {
  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  foreach ($pid in @($state.frontend_pid, $state.backend_pid)) {
    if ($pid) {
      Stop-Process -Id $pid -Force
    }
  }
  Remove-Item $StateFile -Force
}

foreach ($port in @(3000, 8000)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force
    }
}

Write-Host "Stopped." -ForegroundColor Green
Start-Sleep -Seconds 2
