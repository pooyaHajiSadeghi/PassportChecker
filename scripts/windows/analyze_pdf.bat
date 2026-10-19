@echo off
setlocal
cd /d "%~dp0..\.."
if not exist .venv\Scripts\python.exe (
  echo Run scripts\windows\setup.bat first.
  exit /b 2
)
.venv\Scripts\python.exe -m app.cli %*
exit /b %errorlevel%
