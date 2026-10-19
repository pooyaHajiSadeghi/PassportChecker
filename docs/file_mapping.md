# File migration map

| Previous path | New path |
| --- | --- |
| api.py | app/api.py |
| test.py (service code) | app/services/passport_service.py |
| test.py (command-line entry) | app/cli.py |
| test.py (OCR environment configuration) | app/config/settings.py |
| colleague_backend.py | app/core/mrz_engine.py |
| web/index.html | frontend/index.html |
| web/passport-checker.js | frontend/passport-checker.js |
| .env | config/.env |
| .env.example | config/.env.example |
| requirements.txt | requirements/base.txt |
| setup_env.bat | scripts/windows/setup.bat |
| run_api.bat | scripts/windows/start_server.bat |
| run.bat | scripts/windows/analyze_pdf.bat |
| setup_env.sh | scripts/linux/setup.sh |
| README.md | README.md and docs/analysis_behavior.md |
| README.txt | Consolidated into README.md |

The original test.py was application code, not a test suite. Its responsibilities are now separated. Existing .env values must be copied into config/.env. The package does not include personal PDFs, runtime environments or credentials.
