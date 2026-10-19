"""Command-line interface for environment checks and passport analysis."""
import argparse
import json
import sys
from pathlib import Path
from app.config.settings import configure_tesseract
from app.services.passport_service import PassportMRZChecker

def main():
    parser = argparse.ArgumentParser(description='Passport checks using colleague backend')
    parser.add_argument('pdf', nargs='?', type=Path)
    parser.add_argument('--page', type=int, default=1, help='1-based PDF page number')
    parser.add_argument('--check-env', action='store_true')
    parser.add_argument('--force-phase2', action='store_true', help='TEST ONLY: extract despite failed validation')
    args = parser.parse_args()
    try:
        if args.check_env:
            print('Python:', sys.version.split()[0])
            print('Environment:', sys.prefix)
            print('Tesseract:', configure_tesseract())
            print('Dependencies: OK')
            return 0
        if args.pdf is None:
            parser.error('provide a PDF path or --check-env')
        result = PassportMRZChecker().check(args.pdf, force_phase2=args.force_phase2, page_number=args.page)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['approved'] else 1
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
