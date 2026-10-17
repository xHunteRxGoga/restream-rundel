@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Поставь его с https://nodejs.org и запусти этот файл ещё раз.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo npm install не прошёл.
    pause
    exit /b 1
  )
)
node src/index.js
if errorlevel 1 pause
