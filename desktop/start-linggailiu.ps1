param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 3000,
  [switch]$NoBrowser,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$DesktopDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DesktopDir
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$RuntimeDir = Join-Path $RootDir ".desktop-runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$StateFile = Join-Path $RuntimeDir "state.json"
$BackendLog = Join-Path $LogDir "backend.log"
$FrontendLog = Join-Path $LogDir "frontend.log"

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Port($Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Http($Url, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
      return $true
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  return $false
}

Write-Host "Linggailiu local launcher" -ForegroundColor Cyan
Write-Host "Project: $RootDir"

if (-not (Test-Command "python")) {
  throw "python was not found. Install Python 3.11+ or add Python to PATH."
}
if (-not (Test-Command "npm.cmd")) {
  throw "npm was not found. Install Node.js 20+ or add npm to PATH."
}

$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Write-Host "Creating backend virtual environment..." -ForegroundColor Yellow
  Push-Location $BackendDir
  python -m venv .venv
  Pop-Location
}

Write-Host "Checking backend dependencies..." -ForegroundColor Yellow
Push-Location $BackendDir
& $VenvPython -m pip install -r requirements.txt
Pop-Location

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
  Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
  Push-Location $FrontendDir
  npm.cmd install
  Pop-Location
}

$BackendStarted = $false
if (Test-Port $BackendPort) {
  Write-Host "Backend port $BackendPort is already in use. Reusing existing backend." -ForegroundColor Green
} else {
  Write-Host "Starting backend http://127.0.0.1:$BackendPort ..." -ForegroundColor Yellow
  $oldBackendPort = $env:BACKEND_PORT
  $oldDatabaseUrl = $env:DATABASE_URL
  $oldStorageRoot = $env:STORAGE_ROOT
  $oldFrontendOrigin = $env:FRONTEND_ORIGIN
  $env:BACKEND_PORT = "$BackendPort"
  $env:DATABASE_URL = "sqlite:///./storage/ai_workflow.db"
  $env:STORAGE_ROOT = "./storage"
  $env:FRONTEND_ORIGIN = "http://127.0.0.1:$FrontendPort"
  $backendProcess = Start-Process -FilePath $VenvPython -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") -WorkingDirectory $BackendDir -WindowStyle Hidden -RedirectStandardOutput $BackendLog -RedirectStandardError (Join-Path $LogDir "backend.err.log") -PassThru
  $env:BACKEND_PORT = $oldBackendPort
  $env:DATABASE_URL = $oldDatabaseUrl
  $env:STORAGE_ROOT = $oldStorageRoot
  $env:FRONTEND_ORIGIN = $oldFrontendOrigin
  $BackendStarted = $true
}

if (-not (Wait-Http "http://127.0.0.1:$BackendPort/health" 45)) {
  throw "Backend failed to start. Check log: $BackendLog"
}
Write-Host "Backend is ready." -ForegroundColor Green

$FrontendStarted = $false
if (Test-Port $FrontendPort) {
  Write-Host "Frontend port $FrontendPort is already in use. Reusing existing frontend." -ForegroundColor Green
} else {
  Write-Host "Starting frontend http://127.0.0.1:$FrontendPort ..." -ForegroundColor Yellow
  $oldApiBase = $env:NEXT_PUBLIC_API_BASE_URL
  $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$BackendPort"
  $frontendProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "-H", "127.0.0.1", "-p", "$FrontendPort") -WorkingDirectory $FrontendDir -WindowStyle Hidden -RedirectStandardOutput $FrontendLog -RedirectStandardError (Join-Path $LogDir "frontend.err.log") -PassThru
  $env:NEXT_PUBLIC_API_BASE_URL = $oldApiBase
  $FrontendStarted = $true
}

if (-not (Wait-Http "http://127.0.0.1:$FrontendPort" 60)) {
  throw "Frontend failed to start. Check log: $FrontendLog"
}
Write-Host "Frontend is ready." -ForegroundColor Green

$state = [ordered]@{
  backend_port = $BackendPort
  frontend_port = $FrontendPort
  backend_pid = if ($BackendStarted) { $backendProcess.Id } else { $null }
  frontend_pid = if ($FrontendStarted) { $frontendProcess.Id } else { $null }
  backend_log = $BackendLog
  frontend_log = $FrontendLog
  started_at = (Get-Date).ToString("s")
}
$state | ConvertTo-Json | Set-Content -Encoding UTF8 $StateFile

$Url = "http://127.0.0.1:$FrontendPort"
if (-not $NoBrowser) {
  Start-Process $Url
}

Write-Host ""
Write-Host "Linggailiu is running: $Url" -ForegroundColor Cyan
Write-Host "Backend log: $BackendLog"
Write-Host "Frontend log: $FrontendLog"
Write-Host "Stop services: double-click desktop\stop-linggailiu.bat"
Write-Host ""
if (-not $NoPause) {
  Read-Host "Press Enter to close this launcher window. Services will keep running in the background"
}
