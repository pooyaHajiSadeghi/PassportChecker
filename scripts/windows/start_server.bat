@echo off
setlocal
cd /d "%~dp0..\.."
if not exist .venv\Scripts\python.exe (
  echo Run scripts\windows\setup.bat first.
  exit /b 2
)
.venv\Scripts\python.exe -m app.cli --check-env
if errorlevel 1 exit /b 2
echo Open http://127.0.0.1:8000 in your browser.
.venv\Scripts\python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 8000
