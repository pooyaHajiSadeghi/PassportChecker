@echo off
setlocal
cd /d "%~dp0..\.."
if exist .venv\Scripts\python.exe goto install
py -3.10 -m venv .venv
if errorlevel 1 (
  echo Python 3.10 is required. Install it with the Python launcher.
  exit /b 1
)
:install
.venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m pip install -r requirements\base.txt
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m pip check
if errorlevel 1 exit /b 1
if not exist config\.env copy config\.env.example config\.env >nul
.venv\Scripts\python.exe -m app.cli --check-env
if errorlevel 1 (
  echo Install Tesseract OCR with English language data and configure config\.env, then rerun this script.
  exit /b 1
)
echo Setup complete.
