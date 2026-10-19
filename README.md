<div align="center">

# PassportChecker

**Turn passport PDFs into structured data with live OCR checks.**

A Python + FastAPI application with an interactive browser interface, page selection, streamed analysis progress, and downloadable JSON.

[Getting started](#getting-started) · [API](#api) · [JSON output](#structured-json-output) · [Troubleshooting](#troubleshooting)

Developed by **[Pooya Haji Sadeghi](https://github.com/pooyaHajiSadeghi)**

</div>

## From Passport Pages to Structured Data

Explore the live analysis experience and structured JSON extraction.

| Live Passport Analysis | Structured JSON Extraction |
| :---: | :---: |
| ![PassportChecker live analysis and progress interface](docs/images/live-passport-analysis.png) | ![PassportChecker passport information and structured JSON export](docs/images/passport-to-json.png) |

*Promotional illustrations of the application workflow.*

---

## Overview

PassportChecker reads a selected passport page from a PDF, checks its machine-readable zone (MRZ), and extracts holder details. Its browser interface displays the document preview, individual check results, extracted information, and analysis details as processing progresses.

**A passing result reflects the application's document and MRZ rules. It does not establish document authenticity, the holder's identity, or acceptance by an issuing authority.**

## Features

- **PDF preview and page selection** — choose the passport page in a multi-page document.
- **Live analysis feedback** — receive progress and individual check events through an NDJSON stream.
- **Multiple OCR paths** — combine PassportEye, direct Tesseract MRZ reads, and printed-field OCR.
- **Expanded holder extraction** — include father's name and issue date when readable.
- **Structured JSON export** — download extracted results from the browser.
- **Review warnings** — surface uncertain name extraction for manual review.
- **Bounded rendering** — configurable raster limits help control memory use.
- **Browser and CLI access** — use the interface, HTTP API, or command-line launchers.
- **Windows and Linux scripts** — create an isolated Python environment and start the service.

## How it works

1. Upload a readable, unencrypted PDF of up to **10 MiB**.
2. Select the passport page if the PDF contains multiple pages.
3. The backend renders that page within configured image limits and runs document/MRZ checks.
4. After validation passes, the extraction stage combines MRZ reads with printed-field OCR.
5. Review the check results, extracted fields, and warnings, then download JSON if needed.

Extraction normally skips rejected documents. Missing or ambiguous fields may be `null`; extraction quality depends on the scan and page layout.

## Technology

| Layer | Components |
| --- | --- |
| HTTP service | Python, FastAPI, Uvicorn |
| PDF rendering | PyMuPDF |
| OCR and MRZ | Tesseract OCR, pytesseract, PassportEye |
| Image processing | OpenCV, Pillow, NumPy, SciPy, scikit-image |
| Browser interface | HTML, JavaScript, PDF.js |
| Progress transport | Newline-delimited JSON (NDJSON) |

The OCR pipeline runs on the backend. The browser preview loads PDF.js from a public CDN, so the default frontend is not fully offline.

## Project structure

```text
PassportChecker/
├── app/
│   ├── api.py                       # HTTP endpoints and event streaming
│   ├── cli.py                       # Command-line entry point
│   ├── config/settings.py           # Environment and executable paths
│   ├── core/
│   │   ├── mrz_engine.py            # MRZ checks and OCR pipeline
│   │   └── holder_extraction.py     # Holder and printed-field extraction
│   └── services/passport_service.py # Analysis orchestration and output mapping
├── frontend/
│   ├── index.html                   # Browser entry point
│   └── passport-checker.js          # Interface, preview, and API client
├── config/.env.example              # Configuration template
├── requirements/base.txt            # Python dependencies
├── scripts/
│   ├── windows/                     # Setup, server, and CLI launchers
│   └── linux/                       # Equivalent shell launchers
├── tests/                           # Extraction and integration logic tests
└── docs/                            # Behavior and migration documentation
```

## Getting started

Clone the repository, then follow the installation steps for your operating system below:

```bash
git clone https://github.com/pooyaHajiSadeghi/PassportChecker.git
cd PassportChecker
```

Use **64-bit Python 3.10** with the supplied Windows setup script. The dependency ranges target Python **3.10–3.12**; on Linux, select the installed compatible interpreter with `PYTHON_BIN`.


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


## Command-line usage

Run from the project root:

**Windows**

```bat
scripts\windows\analyze_pdf.bat "C:\documents\passport.pdf" --page 1
```

**Linux**

```bash
bash scripts/linux/analyze_pdf.sh /absolute/path/passport.pdf --page 1
```

Page numbers are **1-based**. Relative PDF paths passed to launchers resolve from the project root. The CLI prints the complete response envelope; its `result` field contains the concise extracted JSON.

| Exit code | Meaning |
| --- | --- |
| `0` | Approved by the application checks |
| `1` | Rejected by the application checks |
| `2` | Execution or environment error |

`--force-phase2` is a CLI-only testing option for extraction after rejection. It does not change the approval decision.

## API

Start the server, then open [the interface](http://127.0.0.1:8000) or [interactive API documentation](http://127.0.0.1:8000/docs).

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Browser interface |
| `POST` | `/api/passport/check` | Final JSON response |
| `POST` | `/api/passport/check/stream` | Streamed progress, checks, and final response |

Both POST endpoints accept `multipart/form-data`:

| Field | Type | Description |
| --- | --- | --- |
| `file` | PDF file | Required; maximum 10 MiB |
| `page_number` | Integer | 1-based; required for multi-page PDFs |

### Request example

```bash
curl -X POST http://127.0.0.1:8000/api/passport/check \
  -F "file=@/absolute/path/passport.pdf" \
  -F "page_number=1"
```

For live results, use `curl -N` with `/api/passport/check/stream`. Each line is a separate JSON event with type `progress`, `check`, `heartbeat`, `result`, or `error`. Read the stream through completion and handle error events; an open HTTP stream alone does not mean analysis succeeded.

The regular response includes `approved`, `message`, `analysis`, `passport`, `errors`, `result`, `extraction_performed`, `successful_mrz_reads`, and `page_number`.

## Structured JSON output

The `result` field and browser JSON download use the following shape. All values below are fictional examples:

```json
{
  "Passport": "Valid",
  "First name": "ALEX",
  "Last name": "EXAMPLE",
  "Father's name": null,
  "Passport number": "EXAMPLE01",
  "Nationality": "UTO",
  "Date of birth": "1990-01-01",
  "Sex": "M",
  "Issue date": "2022-01-01",
  "Expiry date": "2032-01-01"
}
```

Rejected results use `"Passport": "Not Valid"` and include `Reasons`. `Warnings` may be present when manual review is needed. Consumers should handle missing or null extraction values rather than assuming every field is available.

## Data handling and deployment

Uploaded PDFs are processed using temporary storage. The application does not retain extra server-side PDF or JSON output files; JSON export is downloaded through the browser. Account for operating-system temporary storage, application logs, and reverse-proxy logging when deploying.

The supplied API has no authentication layer. Restrict access or add authentication before making it available to other users. Keep real passports, extracted personal data, `config/.env`, and `.venv` out of Git commits.

## Limitations

- OCR can misread text, especially on blurry, rotated, compressed, or low-resolution scans.
- Printed-field extraction assumes the data page occupies the lower 60% of the selected page; other layouts may yield incomplete results.
- MRZ check digits validate encoded field consistency. Names have no check digit, and successful MRZ checks do not prove authenticity.
- Additional OCR passes increase processing time. Lower rendering budgets can reduce memory use and OCR detail.
- The current analyzer accepts one analysis at a time per process; concurrent requests can receive a busy response.
- Dependency ranges are not a fully locked environment. Validate installation on the target server.

## Development and validation

With the virtual environment active, run:

```bash
python -m unittest discover -s tests -v
```

Included tests cover extraction decisions and service integration. Full OCR accuracy and browser behavior should also be verified with appropriate non-sensitive test documents on the target machine.

## Further documentation

- [Analysis behavior](docs/analysis_behavior.md)
- [Extraction details](docs/extraction_update.md)
- [File migration map](docs/file_mapping.md)

## Author

**Pooya Haji Sadeghi** · [GitHub](https://github.com/pooyaHajiSadeghi)

For bugs or feature requests, [open an issue](https://github.com/pooyaHajiSadeghi/PassportChecker/issues) with reproduction steps and sanitized logs. Use synthetic samples instead of real passport data.
