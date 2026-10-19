"""Project paths, environment loading and OCR executable configuration."""
import os
import shutil
from pathlib import Path
from dotenv import load_dotenv
import pytesseract

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / 'frontend'
ENV_FILE = PROJECT_ROOT / 'config' / '.env'
load_dotenv(ENV_FILE, override=False)

def configure_tesseract():
    configured = os.getenv('TESSERACT_CMD', '').strip()
    candidates = [configured] if configured else [shutil.which('tesseract')]
    if not configured and os.name == 'nt':
        candidates.append(str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Tesseract-OCR/tesseract.exe'))
    executable = next((str(p) for p in candidates if p and (Path(p).is_file() or shutil.which(str(p)))), None)
    if not executable:
        raise RuntimeError('Install Tesseract OCR and configure TESSERACT_CMD in .env or add it to PATH.')
    pytesseract.pytesseract.tesseract_cmd = executable
    version = str(pytesseract.get_tesseract_version())
    if 'eng' not in pytesseract.get_languages(config=''):
        raise RuntimeError('Tesseract English language data is missing.')
    return version

