#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
"${PYTHON_BIN:-python3.10}" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements/base.txt
.venv/bin/python -m pip check
if [ ! -f config/.env ]; then cp config/.env.example config/.env; fi
.venv/bin/python -m app.cli --check-env
