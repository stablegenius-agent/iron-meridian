@echo off
rem IRON MERIDIAN launcher: starts the local server (if needed) and opens the game in an Edge app window.
cd /d "%~dp0"
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:8777/).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  start "IRON MERIDIAN server" /min "%USERPROFILE%\.local\bin\uv.exe" run --no-project python tools\serve.py 8777
  timeout /t 2 /nobreak >nul
)
start "" msedge --app=http://localhost:8777/ --start-maximized
