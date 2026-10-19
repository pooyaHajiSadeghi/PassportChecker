# Passport Checker

A FastAPI passport PDF analyzer with a JavaScript interface, PDF preview, page selection and live streamed check results.

## Folder structure

```text
PassportChecker/
  app/
    api.py                        # HTTP endpoints and NDJSON stream
    cli.py                        # Command-line entry point
    config/settings.py            # Paths, .env loading and Tesseract setup
    core/mrz_engine.py            # OCR, validation and extraction algorithms
    services/passport_service.py  # Analysis pipeline and response mapping
  frontend/
    index.html                    # Minimal host page
    passport-checker.js            # UI, styles, PDF preview and API client
  config/.env.example             # Environment template
  requirements/base.txt           # Python dependencies
  scripts/windows/                # Setup, web server and CLI launchers
  scripts/linux/                  # Equivalent shell launchers
  docs/
    file_mapping.md               # Previous-to-new file paths
    analysis_behavior.md          # Detailed analysis behavior
```

## Windows setup

Install Python 3.10 with the Python launcher and Tesseract OCR with English language data. Then run:

```bat
scripts\windows\setup.bat
scripts\windows\start_server.bat
```

Setup creates `.venv` in the project root and copies `config/.env.example` to `config/.env` if it does not exist. Set `TESSERACT_CMD` there if Tesseract is not on PATH. Existing environment variables take precedence. Open http://127.0.0.1:8000.

## Linux setup

Install Python 3.10, its venv support, Tesseract OCR and English language data. Run:

```bash
bash scripts/linux/setup.sh
bash scripts/linux/start_server.sh
```

Use `PYTHON_BIN=python3.11 bash scripts/linux/setup.sh` to choose a compatible Python version (3.10–3.12). All launchers resolve the project root from their own location.

## Analyze a PDF from the command line

```bat
scripts\windows\analyze_pdf.bat "C:\documents\passport.pdf" --page 1
```

```bash
bash scripts/linux/analyze_pdf.sh /absolute/path/passport.pdf --page 1
```

Relative PDF paths passed to launchers are resolved from the project root. Exit codes: 0 approved, 1 rejected, 2 execution error. `--force-phase2` is a CLI-only testing option that extracts after rejection without changing approval.

## Direct Python commands

Run from the project root using the virtual environment's Python:

```bash
python -m app.cli --check-env
python -m app.cli passport.pdf --page 1
python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

## API and frontend

- `GET /`: serves the minimal HTML host.
- `/static/passport-checker.js`: serves the frontend JavaScript; the public URL remains unchanged.
- `POST /api/passport/check`: final JSON response.
- `POST /api/passport/check/stream`: NDJSON progress, check, heartbeat, result and error events.
- Multipart fields: `file` and `page_number` (required for multi-page PDFs).
- Maximum upload: 10 MiB. PDF.js preview uses a public CDN.

The analysis algorithm and validation rules are unchanged. Holder extraction now combines MRZ and printed OCR, including father's name and issue date; see docs/extraction_update.md. The UI and API contracts are unchanged. Restart the server after migration and hard-refresh the browser.

## Migrating an existing installation

Extract into a clean project directory. Copy your existing environment values into `config/.env`, then run setup. Do not copy the old virtual environment; recreate it. Use the new launchers and the `app.api:app` Uvicorn target. See `docs/file_mapping.md` for every renamed file.

## Server installation checklist

Tesseract OCR is a separate operating-system program. Installing `pytesseract` with pip only installs its Python interface. Install Tesseract and the English (`eng`) language data on every server. The current pipeline does not require Persian language data.

### Windows server

1. Install 64-bit Python 3.10, including the Python Launcher. The supplied Windows setup script uses `py -3.10`.
2. Install Tesseract OCR with English language data. The official documentation links to the UB Mannheim Windows installer:
   - https://tesseract-ocr.github.io/tessdoc/Installation.html
   - https://github.com/UB-Mannheim/tesseract/wiki
3. Extract the project into a directory accessible to the account that will run the server.
4. Open Command Prompt in the project root and run:

```bat
scripts\windows\setup.bat
```

If setup reports that Tesseract is missing, edit the generated `config\.env` file:

```env
TESSERACT_CMD=C:/Program Files/Tesseract-OCR/tesseract.exe
```

Use the actual installation path. Then rerun setup:

```bat
scripts\windows\setup.bat
```

5. Verify and start the application:

```bat
.venv\Scripts\python.exe -m app.cli --check-env
scripts\windows\start_server.bat
```

6. Open http://127.0.0.1:8000 on the server. Upload a PDF, select its passport page if necessary, and check that streamed results appear.

### Ubuntu / Debian server

1. Install the operating-system dependencies:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip tesseract-ocr tesseract-ocr-eng
python3 --version
```

Use Python 3.10, 3.11 or 3.12 for the current dependency ranges. If the distribution's default Python is outside that range, install a supported interpreter with its matching venv package and pass its executable through `PYTHON_BIN` below.

2. Extract the project, open a terminal in its root and run:

```bash
PYTHON_BIN=python3 bash scripts/linux/setup.sh
```

The `PYTHON_BIN` override is necessary when using the system `python3`: the script otherwise defaults to `python3.10`. For example, if Python 3.12 is installed:

```bash
PYTHON_BIN=python3.12 bash scripts/linux/setup.sh
```

3. Setup creates `config/.env`. Tesseract is normally detected through PATH; leave `TESSERACT_CMD` blank or specify its actual path:

```env
TESSERACT_CMD=/usr/bin/tesseract
```

Find the executable path with:

```bash
command -v tesseract
```

4. Verify and start:

```bash
.venv/bin/python -m app.cli --check-env
bash scripts/linux/start_server.sh
```

5. Open http://127.0.0.1:8000 on the server, or use an SSH tunnel to access this loopback-only listener from your computer.

### Verify Tesseract and language data

If Tesseract is on PATH, these commands work on either operating system:

```text
tesseract --version
tesseract --list-langs
```

The language list must contain `eng`. If Windows does not recognize the command, use the full executable path in Command Prompt:

```bat
"C:\Program Files\Tesseract-OCR\tesseract.exe" --version
"C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

`TESSDATA_PREFIX` is normally unnecessary. Only set it if Tesseract cannot find its language data; use the actual directory containing `eng.traineddata`. Example for a standard Windows installation:

```env
TESSDATA_PREFIX=C:/Program Files/Tesseract-OCR/tessdata
```

Linux language-data paths vary by distribution and Tesseract version. Use the directory reported by `tesseract --list-langs`; do not copy a path from another server without checking it. See https://tesseract-ocr.github.io/tessdoc/FAQ.html.

### Environment and rendering settings

All project-specific settings belong in `config/.env`:

```env
TESSERACT_CMD=
MAX_RENDER_PIXELS=12000000
MAX_RENDER_SIDE=6000
```

- `TESSERACT_CMD`: path to the installed OCR executable, or blank for automatic detection.
- `TESSDATA_PREFIX`: optional language-data directory; omit it unless necessary.
- `MAX_RENDER_PIXELS`: raster pixel budget. Lowering it reduces memory use but can reduce OCR detail.
- `MAX_RENDER_SIDE`: maximum rendered image side length.

The process environment takes precedence over `config/.env`. Restart the Python server after changing settings.

### Moving to a new server

1. Copy the source project and requirements to the new server.
2. Install Python and Tesseract there.
3. Do not copy `.venv`; recreate it using the destination operating system's setup script.
4. Copy the required configuration values into `config/.env` and update machine-specific paths.
5. Run `--check-env`, start the API and test an actual PDF.
6. Keep the entire project structure together; launchers and static-file paths depend on it.

### Internet hosting and automatic startup

The supplied launchers bind to `127.0.0.1:8000`. This is a local listener, not an Internet deployment configuration.

For a public service, place the application behind an HTTPS reverse proxy and configure it to forward `/`, `/static/` and `/api/` to the Python process. Disable response buffering for `/api/passport/check/stream` so check events arrive immediately. Set the proxy's upload limit to accommodate the 10 MiB PDF plus multipart overhead and allow enough time for OCR.

Run the application under a dedicated account and configure automatic restart/startup through systemd on Linux or an appropriate Windows service manager. Use the project virtual environment's Python and set the working directory to the project root. Example process commands:

```text
Linux:   /absolute/project/path/.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
Windows: C:\absolute\project\path\.venv\Scripts\python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Keep one application worker for the current design: the analyzer lock is process-local. Automatic service and reverse-proxy configuration are not included in this package. Configure these for the chosen server before public deployment.

### Troubleshooting

| Symptom | Action |
| --- | --- |
| Tesseract executable not found | Install it and correct `TESSERACT_CMD`, then restart the server. |
| `eng` missing or `eng.traineddata` not found | Install English language data; check `TESSDATA_PREFIX` only if needed. |
| Python 3.10 not found on Windows | Install Python 3.10 with Python Launcher; confirm `py -3.10 --version`. |
| `python3.10` not found on Linux | Run setup with `PYTHON_BIN=python3` when it is a supported version. |
| Module import error | Use `.venv` Python, run setup and start from the project root. |
| Checks arrive only at the end behind a proxy | Disable buffering for the NDJSON endpoint and confirm the frontend uses `/api/passport/check/stream`. |
| Changes to settings do not apply | Restart Python and check for overriding process environment variables. |

## Extraction update

See `docs/extraction_update.md` for the approved colleague extraction integration, added fields and structured JSON download. Rerun the setup script after updating, then restart the API and hard-refresh the browser.
