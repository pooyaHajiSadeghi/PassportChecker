#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -x .venv/bin/python ]; then echo "Run scripts/linux/setup.sh first."; exit 2; fi
.venv/bin/python -m app.cli --check-env
.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
