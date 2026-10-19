import argparse
import io
import math
import os
import warnings
from datetime import date
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import pymupdf
from dateutil.relativedelta import relativedelta
from passporteye import read_mrz

# Hide scikit-image deprecation warnings so the console output stays readable
warnings.filterwarnings("ignore", category=FutureWarning)

# =============================================================================
# Configuration
# =============================================================================
# Page widths (in pixels) used for rendering; large widths worked best on real scans
RENDER_WIDTHS = (1400, 1900, 2400, 2800, 3300, 3800, 4200)
# None = full page, 0.5 = bottom half only (a focused MRZ crop)
BOTTOM_FRACTIONS = (None, 0.5)
# An MRZ read below this valid_score is considered unreliable
MIN_VALID_SCORE = 50
# Passport must have MORE than this many months of validity left
MIN_MONTHS_VALIDITY = 18
# Age at which a signature becomes required
ADULT_AGE = 18
SIGNATURE_RENDER_WIDTH = 1600


# =============================================================================
# Shared helpers (rendering and MRZ reading)
# =============================================================================
def render_limits():
    """Limits apply to each output raster, not total OCR-process memory."""
    def setting(name, default, minimum, maximum):
        try:
            return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
        except (TypeError, ValueError):
            return default
    return (
        setting('MAX_RENDER_PIXELS', 12000000, 1000000, 30000000),
        setting('MAX_RENDER_SIDE', 6000, 1200, 10000),
    )


def render_plan(page, width, bottom_fraction=None):
    rect = pymupdf.Rect(page.rect)
    if not rect.is_valid or rect.is_empty:
        raise ValueError('Invalid PDF page dimensions')
    if bottom_fraction is not None:
        if not 0 < bottom_fraction <= 1:
            raise ValueError('Bottom fraction must be between 0 and 1')
        rect.y0 = rect.y1 - rect.height * bottom_fraction
    pixel_limit, side_limit = render_limits()
    # Leave rounding headroom because get_pixmap rounds clip coordinates outward.
    zoom = min(
        width / page.rect.width,
        math.sqrt((pixel_limit * 0.995) / (rect.width * rect.height)),
        (side_limit - 2) / max(rect.width, rect.height),
    )
    if not math.isfinite(zoom) or zoom <= 0:
        raise ValueError('Invalid render scale')
    return rect, zoom


def render_page(page, width: int, bottom_fraction=None) -> bytes:
    """Rasterize only the needed region under a pixel/side budget.

    PNG encoding is lossless. Reducing raster resolution can lose fine detail;
    the source PDF is never rewritten. A direct MRZ crop keeps higher resolution
    than downscaling the entire page before cropping it.
    """
    rect, zoom = render_plan(page, width, bottom_fraction)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect,
                          colorspace=pymupdf.csRGB, alpha=False)
    pixel_limit, side_limit = render_limits()
    if pix.width * pix.height > pixel_limit or max(pix.width, pix.height) > side_limit:
        raise ValueError('PDF render exceeded the configured pixel limit')
    return pix.tobytes('png')


def decode_png(png_bytes: bytes) -> np.ndarray:
    """Decode PNG bytes into a BGR image."""
    return cv2.imdecode(np.frombuffer(png_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)


def crop_bottom(png_bytes: bytes, fraction: float) -> bytes:
    """Keep only the bottom `fraction` of the image (where the MRZ lives)."""
    img = decode_png(png_bytes)
    top = int(img.shape[0] * (1 - fraction))
    ok, encoded = cv2.imencode(".png", img[top:, :])
    # If encoding fails, fall back to the uncropped image
    return encoded.tobytes() if ok else png_bytes


def collect_mrz_attempts(pdf_path: Path, progress_callback=None, page_index=0) -> list:
    """Run MRZ OCR on several widths/crops and return every successful read.
    Both phases reuse this list, so OCR runs only once."""
    attempts = []
    doc = pymupdf.open(str(pdf_path))
    try:
        page = doc[page_index]
        completed = 0
        total = len(RENDER_WIDTHS) * len(BOTTOM_FRACTIONS)
        report = progress_callback or (lambda percent, message: None)
        for width in RENDER_WIDTHS:
            for fraction in BOTTOM_FRACTIONS:
                report(5 + int(75 * completed / total), f"Reading MRZ · attempt {completed + 1} of {total}")
                completed += 1
                try:
                    candidate = render_page(page, width, bottom_fraction=fraction)
                    mrz = read_mrz(io.BytesIO(candidate))
                except Exception as error:
                    # One failed attempt must not stop the others
                    print(f"  attempt width={width} crop={fraction}: error {error}")
                    continue
                if mrz is None:
                    continue
                data = mrz.to_dict()
                data["render_width"] = width
                data["crop_fraction"] = fraction
                rect, zoom = render_plan(page, width, fraction)
                data["effective_render_width"] = round(rect.width * zoom)
                attempts.append(data)
    finally:
        doc.close()
    report(80, "MRZ reading complete")
    return attempts


def score_of(attempt: dict) -> int:
    """valid_score of an attempt (0 if missing)."""
    return attempt.get("valid_score") or 0


def parse_mrz_date(yymmdd, is_birth: bool, today: date) -> Optional[date]:
    """Convert MRZ YYMMDD to a date.
    Birth dates that land in the future are shifted back 100 years (19xx);
    expiry dates are always assumed to be 20xx."""
    if not (isinstance(yymmdd, str) and len(yymmdd) == 6 and yymmdd.isdigit()):
        return None
    year, month, day = 2000 + int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    try:
        result = date(year, month, day)
        if is_birth and result > today:
            result = date(year - 100, month, day)
    except ValueError:
        return None
    return result


# =============================================================================
# Phase 1: validation
# =============================================================================
def analyze_signature(
    pdf_path: Path,
    width: int = SIGNATURE_RENDER_WIDTH,
    top_frac: float = 0.05,
    bottom_frac: float = 0.35,
    left_frac: float = 0.0,
    right_frac: float = 0.32,
    dark_thresh: int = 150,
    min_ink_ratio: float = 0.025,
    min_blue_ratio: float = 0.0002,
    page_index: int = 0,
) -> dict:
    """Check the signature region for visible ink and for blue pixels.
    The region is a fixed fraction of the page, so it depends on the scan layout."""
    doc = pymupdf.open(str(pdf_path))
    try:
        img = decode_png(render_page(doc[page_index], width))
    finally:
        doc.close()

    h, w = img.shape[:2]
    roi = img[int(h * top_frac):int(h * bottom_frac), int(w * left_frac):int(w * right_frac)]

    # Ink ratio: share of dark pixels in the region
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    ink_ratio = float((gray < dark_thresh).sum()) / gray.size

    # Blue ratio: share of pixels inside the blue HSV range
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    blue_mask = cv2.inRange(hsv, np.array([100, 60, 40]), np.array([130, 255, 255]))
    blue_ratio = float(np.count_nonzero(blue_mask)) / blue_mask.size
    is_blue = blue_ratio >= min_blue_ratio

    # A thin blue signature can have low ink_ratio, so either signal counts
    has_signature = ink_ratio >= min_ink_ratio or is_blue
    return {
        "has_signature": has_signature,
        "is_blue": is_blue,
        "ink_ratio": ink_ratio,
        "blue_ratio": blue_ratio,
    }


def phase1_validate(pdf_path: Path, attempts: list, page_index=0, check_callback=None):
    """Apply the validation rules. Returns (is_valid, errors, info)."""
    emit = check_callback or (lambda item: None)
    today = date.today()

    # Keep only reliable reads whose dates can be parsed
    usable = []
    for attempt in attempts:
        dob = parse_mrz_date(attempt.get("date_of_birth"), True, today)
        exp = parse_mrz_date(attempt.get("expiration_date"), False, today)
        if dob and exp and score_of(attempt) >= MIN_VALID_SCORE:
            usable.append((attempt, dob, exp))

    if not usable:
        for key, title in [('validity', 'Remaining passport validity'), ('signature', 'Signature requirement'), ('ink', 'Blue signature ink')]:
            emit(dict(id=key, title=title, state='unknown', label='Not checked', detail='A reliable MRZ read is needed before this check can run.'))
        return False, ["Out_of_standard (MRZ could not be read reliably)"], {}

    best, dob, exp = max(usable, key=lambda item: score_of(item[0]))

    age = relativedelta(today, dob).years
    diff = relativedelta(exp, today)
    months_remaining = diff.years * 12 + diff.months  # negative if already expired

    valid = months_remaining > MIN_MONTHS_VALIDITY
    emit(dict(id='validity', title='Remaining passport validity', state='pass' if valid else 'fail', label='Passed' if valid else 'Failed', detail=f'{months_remaining} whole months remaining. More than {MIN_MONTHS_VALIDITY} months are required.'))
    signature = analyze_signature(pdf_path, page_index=page_index)
    has_signature, is_blue = signature["has_signature"], signature["is_blue"]

    adult = age >= ADULT_AGE
    signature_ok = has_signature if adult else not has_signature
    emit(dict(id='signature', title='Required signature' if adult else 'Signature rule for applicants under 18', state='pass' if signature_ok else 'fail', label='Passed' if signature_ok else 'Failed', detail=('A signature is required.' if adult else 'A signature is not permitted under 18.') + (' A signature was detected.' if has_signature else ' No signature was detected.')))
    ink_state = ('pass' if is_blue else 'fail') if adult and has_signature else ('na' if not adult else 'skipped')
    emit(dict(id='ink', title='Blue signature ink', state=ink_state, label={'pass':'Passed','fail':'Failed','na':'Not required','skipped':'Not checked'}[ink_state], detail='Blue ink was detected.' if ink_state == 'pass' else 'The detected signature was not identified as blue.' if ink_state == 'fail' else 'Blue ink is not required under 18.' if ink_state == 'na' else 'Ink cannot be evaluated because no signature was detected.'))
    errors = []
    if age < ADULT_AGE:
        if has_signature:
            errors.append("Has_signature (signature is not permitted under 18)")
    elif not has_signature:
        errors.append("There is no signature")
    elif not is_blue:
        errors.append("Signature is not blue")

    if months_remaining <= MIN_MONTHS_VALIDITY:
        errors.append(f"Validity limited ({months_remaining} months remaining, need more than {MIN_MONTHS_VALIDITY})")

    info = {
        "age": age,
        "months_remaining": months_remaining,
        "has_signature": has_signature,
        "is_blue": is_blue,
        "best_valid_score": score_of(best),
    }
    return not errors, errors, info


# =============================================================================
# Phase 2: extraction
# =============================================================================
def clean_text(text) -> str:
    """Replace MRZ filler '<' with spaces and normalise whitespace."""
    return " ".join(str(text or "").replace("<", " ").split())


def weighted_vote(candidates: list) -> Optional[str]:
    """Pick the value with the highest total weight; weights are valid_scores,
    so ties are broken in favour of higher-quality reads."""
    totals = {}
    for value, weight in candidates:
        if value:
            totals[value] = totals.get(value, 0) + weight
    return max(totals, key=totals.get) if totals else None

def weighted_vote(candidates: list) -> Optional[str]:
    """Pick the value with the highest total weight; weights are valid_scores,
    so ties are broken in favour of higher-quality reads."""
    totals = {}
    for value, weight in candidates:
        if value:
            totals[value] = totals.get(value, 0) + weight
    return max(totals, key=totals.get) if totals else None


def vote_field(attempts, key, transform=None, check_key=None, allowed=None):
    """Weighted vote for one MRZ field.
    check_key: only attempts whose check digit is valid may vote.
    allowed: restrict votes to a known set of values."""
    candidates = []
    for attempt in attempts:
        if check_key and not attempt.get(check_key):
            continue
        value = attempt.get(key)
        value = transform(value) if transform else value
        if allowed is not None and value not in allowed:
            continue
        candidates.append((value, score_of(attempt) or 1))
    return weighted_vote(candidates)

def vote_name_tokens(attempts: list, key: str, min_share: float = 0.5) -> Optional[str]:
    """Vote on each word of a name separately, one equal vote per read.
    valid_score is NOT used as a weight here: it measures the numeric MRZ line,
    not the accuracy of the name line, so it would bias the vote.
    A word is kept only if it appears in at least `min_share` of all reads.
    OCR garbage (e.g. 'GGGGSKEKKK') differs on every read and is dropped."""
    total = len(attempts)
    if total == 0:
        return None

    token_votes = {}       # word -> number of reads that contain it
    token_positions = {}   # word -> positions it had, used to restore word order
    for attempt in attempts:
        tokens = clean_text(attempt.get(key)).split()
        # dict.fromkeys removes duplicates inside one read while keeping order
        for position, token in enumerate(dict.fromkeys(tokens)):
            token_votes[token] = token_votes.get(token, 0) + 1
            token_positions.setdefault(token, []).append(position)

    kept = [t for t, v in token_votes.items() if v / total >= min_share]
    if not kept and token_votes:
        # Nothing reached the threshold: fall back to the single most frequent word
        kept = [max(token_votes, key=token_votes.get)]

    # Restore the original word order (average position across reads)
    kept.sort(key=lambda t: sum(token_positions[t]) / len(token_positions[t]))
    return " ".join(kept) or None


def phase2_extract(attempts: list) -> dict:
    """Extract the passport fields by voting across all reliable reads."""
    today = date.today()
    good = [a for a in attempts if score_of(a) >= MIN_VALID_SCORE]
    notes = []

    def pick(label, key, **kwargs):
        value = vote_field(good, key, **kwargs)
        if value is None and kwargs.get("check_key"):
            # No read had a valid check digit: fall back, but flag it
            relaxed = {k: v for k, v in kwargs.items() if k != "check_key"}
            value = vote_field(good, key, **relaxed)
            notes.append(f"{label}: check digit could not be verified")
        return value

    number = pick("passport_number", "number", check_key="valid_number",
                  transform=lambda v: str(v or "").replace("<", "").strip())
    dob_raw = pick("date_of_birth", "date_of_birth", check_key="valid_date_of_birth")
    exp_raw = pick("expiry_date", "expiration_date", check_key="valid_expiration_date")

    return {
        # Names have no check digit, so voting is the only protection against OCR errors
        "first_name": vote_name_tokens(good, "names"),
        "last_name": vote_name_tokens(good, "surname"),
        "passport_number": number,
        "nationality": vote_field(good, "nationality", transform=clean_text),
        "date_of_birth": parse_mrz_date(dob_raw, True, today),
        "sex": vote_field(good, "sex", allowed=("M", "F")),
        "expiry_date": parse_mrz_date(exp_raw, False, today),
        "notes": notes,
    }


# =============================================================================
# Pipeline
# =============================================================================
def run_pipeline(pdf_path: str, force_phase2: bool = False) -> Optional[dict]:
    pdf = Path(pdf_path)
    if not pdf.is_file():
        raise FileNotFoundError(f"PDF not found: {pdf}")

    print("Reading MRZ (this may take a while)...")
    attempts = collect_mrz_attempts(pdf)
    print(f"Successful MRZ reads: {len(attempts)}")

    print("\n=== Phase 1: validation ===")
    is_valid, errors, info = phase1_validate(pdf, attempts)
    for key, value in info.items():
        print(f"  {key}: {value}")

    if is_valid:
        print("RESULT: passport is VALID")
    else:
        print("RESULT: passport is NOT valid")
        for error in errors:
            print(f"  - {error}")
        if not force_phase2:
            print("Pipeline stopped before extraction.")
            return None
        print("TEST MODE (--force-phase2): continuing to extraction anyway.")

    if not any(score_of(a) >= MIN_VALID_SCORE for a in attempts):
        print("Extraction skipped: no reliable MRZ read.")
        return None

    print("\n=== Phase 2: extraction ===")
    data = phase2_extract(attempts)
    labels = [
        ("First name", "first_name"),
        ("Last name", "last_name"),
        ("Passport number", "passport_number"),
        ("Nationality", "nationality"),
        ("Date of birth", "date_of_birth"),
        ("Sex", "sex"),
        ("Expiry date", "expiry_date"),
    ]
    for label, key in labels:
        print(f"  {label:<16}: {data[key]}")
    for note in data["notes"]:
        print(f"  WARNING: {note}")
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Passport validation + data extraction")
    parser.add_argument("pdf", nargs="?", default=str(Path(__file__).resolve().parent / "Passport_Antragsteller_13.pdf"))
    parser.add_argument("--force-phase2", action="store_true",
                        help="TEST ONLY: run extraction even if validation fails")
    args = parser.parse_args()
    run_pipeline(args.pdf, args.force_phase2)