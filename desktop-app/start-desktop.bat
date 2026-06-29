@echo off
setlocal
cd /d "%~dp0"
set LINGGAILIU_BACKEND_PORT=18000
set LINGGAILIU_FRONTEND_PORT=13000
if not exist node_modules (
  npm install
)
npm start
endlocal
