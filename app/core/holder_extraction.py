"""Extraction logic from the approved Passport_Check.py.

Only PDF page selection, bounded rendering and progress hooks are adapted.
Duplicate function definitions are collapsed to Python's effective last definition.
"""
import io
import re
from datetime import date
from pathlib import Path
from typing import Optional
import pytesseract
from PIL import Image
import pymupdf
from app.core.mrz_engine import render_page, score_of, parse_mrz_date, MIN_VALID_SCORE

DIRECT_WIDTHS = (1200, 1800, 2400, 3000)

DIRECT_BOTTOM_FRACTIONS = (0.20, 0.30)

MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"

LETTER_TO_DIGIT = str.maketrans("OQDILZSB", "00011258")

DIGIT_TO_LETTER = str.maketrans("10582", "IOSBZ")

LINE2_PATTERN = re.compile(
    r"^([A-Z0-9<]{9})([0-9OQDILZSB])([A-Z0-9<]{3})([0-9OQDILZSB]{6})([0-9OQDILZSB])"
    r"([MF<])([0-9OQDILZSB]{6})([0-9OQDILZSB])"
)

EXTRA_WIDTHS = (1400, 2000, 2600)

EXTRA_BOTTOM_FRACTION = 0.60

MIN_ISSUE_VOTES = 2

MIN_DAYS_BEFORE_EXPIRY = 365

FATHER_RE = re.compile(
    r"F\s*a\s*t\s*h\s*e\s*r\W{0,3}\s*s?\s*N\s*a\s*m\s*e\s*[:;.!]?\s*([A-Z][A-Z!| ]{1,40})",
    re.I)

DATE_RE = re.compile(r"(?<!\d)(\d{2})\s*[/.\-]\s*(\d{2})\s*[/.\-]\s*((?:19|20)\d{2})(?!\d)")

NAME_UNVERIFIED_ACTION = "review"

NAME_REVIEW_MESSAGE = "Name could not be verified reliably (possible OCR noise): manual review recommended"

NAME_REJECT_MESSAGE = "Passport image quality is too low: the name could not be read reliably. Please send a clearer scan"

def check_digit(data: str) -> str:
    """ICAO 9303 check digit: weights 7-3-1, digits as is, A-Z = 10-35, '<' = 0."""
    weights, total = (7, 3, 1), 0
    for index, char in enumerate(data):
        if char.isdigit():
            value = int(char)
        elif char.isalpha():
            value = ord(char) - 55
        else:
            value = 0
        total += value * weights[index % 3]
    return str(total % 10)

def parse_line2(line: str) -> Optional[dict]:
    """Parse the start of MRZ line 2 and verify three check digits ourselves.
    Returns None when the line does not have the expected layout."""
    match = LINE2_PATTERN.match(line)
    if not match:
        return None
    number, c_num, nat, dob, c_dob, sex, exp, c_exp = match.groups()
    c_num, dob, c_dob = (x.translate(LETTER_TO_DIGIT) for x in (c_num, dob, c_dob))
    exp, c_exp = exp.translate(LETTER_TO_DIGIT), c_exp.translate(LETTER_TO_DIGIT)
    return {
        "nationality": nat.translate(DIGIT_TO_LETTER),
        "valid_number": check_digit(number) == c_num,
        "valid_date_of_birth": check_digit(dob) == c_dob,
        "valid_expiration_date": check_digit(exp) == c_exp,
    }

def collect_direct_attempts(pdf_path: Path, page_index=0, progress_callback=None) -> list:
    """Run Tesseract on the page bottom and return reads with line 1 + verified line 2."""
    attempts = []
    doc = pymupdf.open(str(pdf_path))
    try:
        page = doc[page_index]
        for width in DIRECT_WIDTHS:
            if progress_callback:
                progress_callback(94, f"Independent MRZ reader · width {width}")
            full = Image.open(io.BytesIO(render_page(page, width))).convert("L")
            w, h = full.size
            for fraction in DIRECT_BOTTOM_FRACTIONS:
                strip = full.crop((0, int(h * (1 - fraction)), w, h))
                try:
                    text = pytesseract.image_to_string(
                        strip, lang="eng",
                        config=f"--psm 6 -c tessedit_char_whitelist={MRZ_WHITELIST}")
                except Exception as error:
                    # One failed attempt must not stop the others
                    print(f"  direct read width={width} crop={fraction}: error {error}")
                    continue
                lines = [l.strip().replace(" ", "") for l in text.upper().splitlines() if l.strip()]
                for index, line1 in enumerate(lines):
                    if not (line1.startswith("P") and "<<" in line1):
                        continue
                    # Allow one stray line between the two MRZ lines
                    for line2 in lines[index + 1:index + 3]:
                        parsed = parse_line2(line2)
                        if parsed:
                            parsed["line1"] = line1
                            attempts.append(parsed)
                            break
                    break
    finally:
        doc.close()
    return attempts

def read_printed_texts(pdf_path: Path, page_index=0, progress_callback=None) -> list:
    """OCR the lower part of the first page at several widths; returns one text per width."""
    texts = []
    doc = pymupdf.open(str(pdf_path))
    try:
        page = doc[page_index]
        for width in EXTRA_WIDTHS:
            if progress_callback:
                progress_callback(96, f"Reading printed fields · width {width}")
            img = Image.open(io.BytesIO(render_page(page, width))).convert("L")
            w, h = img.size
            strip = img.crop((0, int(h * (1 - EXTRA_BOTTOM_FRACTION)), w, h))
            texts.append(pytesseract.image_to_string(strip, lang="eng", config="--psm 6"))
    finally:
        doc.close()
    return texts

def parse_father_name(texts: list) -> Optional[str]:
    """Father's name from the label line. The text after the name on the same line is
    Persian OCR noise, so words are voted across reads (one equal vote per read)."""
    reads = []
    for text in texts:
        for line in text.splitlines():
            match = FATHER_RE.search(line)
            if match:
                # '!' and '|' are common misreads of the letter I at a word end
                words = [w.replace("!", "I").replace("|", "I") for w in match.group(1).upper().split()]
                reads.append([w for w in words if len(w) > 1])
                break
    reads = [r for r in reads if r]
    if not reads:
        return None
    if len(reads) == 1:
        return reads[0][0]        # one read only: keep the first word, the rest is mostly noise

    votes = {}
    for words in reads:
        for word in dict.fromkeys(words):
            votes[word] = votes.get(word, 0) + 1
    kept = [w for w, v in votes.items() if v / len(reads) > 0.5]
    first_pos = {w: min(r.index(w) for r in reads if w in r) for w in kept}
    return " ".join(sorted(kept, key=first_pos.get)) or None

def _digit_distance(a: date, b: date) -> int:
    """Number of differing digits between two dates written as ddmmyyyy."""
    sa, sb = a.strftime("%d%m%Y"), b.strftime("%d%m%Y")
    return sum(x != y for x, y in zip(sa, sb))

def parse_issue_date(texts: list, dob: Optional[date], exp: Optional[date], today: date) -> Optional[date]:
    """Date of issue by elimination: the Latin date on the page that is neither the
    birth date nor the expiry date (both are known and check-digit verified from the MRZ).
    Returns None unless exactly one candidate is clearly the best (safer than guessing)."""
    if dob is None or exp is None:
        return None
    votes = {}
    for text in texts:
        seen = set()
        for day, month, year in DATE_RE.findall(text):
            try:
                cand = date(int(year), int(month), int(day))
            except ValueError:
                continue
            if cand in (dob, exp):
                continue
            if _digit_distance(cand, dob) <= 1:
                continue          # almost certainly a misread birth date
            if not (dob < cand <= today):
                continue
            if (exp - cand).days < MIN_DAYS_BEFORE_EXPIRY:
                continue          # almost certainly a misread expiry date
            seen.add(cand)
        for cand in seen:
            votes[cand] = votes.get(cand, 0) + 1

    votes = {c: v for c, v in votes.items() if v >= MIN_ISSUE_VOTES}
    if not votes:
        return None
    best = max(votes.values())
    winners = [c for c, v in votes.items() if v == best]
    return winners[0] if len(winners) == 1 else None

def extract_printed_fields(pdf_path: Path, dob: Optional[date], exp: Optional[date], page_index=0, progress_callback=None) -> dict:
    """Never raises: any failure only leaves the two new fields empty."""
    try:
        texts = read_printed_texts(pdf_path, page_index=page_index, progress_callback=progress_callback)
        return {"father_name": parse_father_name(texts),
                "issue_date": parse_issue_date(texts, dob, exp, date.today())}
    except Exception as error:
        print(f"  printed-fields reader failed: {error}")
        return {"father_name": None, "issue_date": None}

def parse_name_line(line1) -> Optional[tuple]:
    """Parse MRZ line 1 into (surname, given_names), or None if the read is unusable.
    Layout: P<ISO SURNAME<<GIVEN<NAMES<<<<<<... The real name ends at the first
    run of 3+ fillers; everything after it is padding that OCR often turns into
    letters like K, S, E, so it is thrown away."""
    line = str(line1 or "").strip().upper()
    if len(line) < 6 or line[0] != "P":
        return None

    field = line[5:]              # skip document type (2 chars) + issuing state (3 chars)
    end = field.find("<<<")       # first run of 3+ fillers = end of the real name
    if end == -1:
        return None               # no clear end of the name, so this read is unreliable
    name = field[:end]

    if "<<" not in name:
        return None               # surname/given separator is damaged (e.g. '<K<')
    surname_part, given_part = name.split("<<", 1)

    def words(part: str) -> str:
        # Single letters are OCR leftovers (e.g. 'K'), so only words of 2+ letters survive
        return " ".join(w for w in part.replace("<", " ").split() if len(w) > 1)

    surname, given = words(surname_part), words(given_part)
    if not surname or not given:
        return None
    return surname, given

def vote_name_tokens(attempts: list, key: str, min_share: float = 0.5) -> Optional[str]:
    """Vote on each word of a name separately, one equal vote per read.
    A word is kept only if it appears in MORE than `min_share` of the reads
    that contain this field. OCR garbage differs on every read, so it never
    reaches a strict majority. Returns None when nothing is reliable."""
    # Only reads that actually contain a value for this field take part
    reads = [a for a in attempts if clean_text(a.get(key))]
    total = len(reads)
    if total == 0:
        return None

    token_votes = {}       # word -> number of reads that contain it
    token_positions = {}   # word -> positions it had, used to restore word order
    for attempt in reads:
        tokens = clean_text(attempt.get(key)).split()
        # dict.fromkeys removes duplicates inside one read while keeping order
        for position, token in enumerate(dict.fromkeys(tokens)):
            token_votes[token] = token_votes.get(token, 0) + 1
            token_positions.setdefault(token, []).append(position)

    # Strictly MORE than min_share, so a word seen in 1 of 2 reads does not pass
    kept = [t for t, v in token_votes.items() if v / total > min_share]
    if not kept:
        return None


    # Restore the original word order (average position across reads)
    kept.sort(key=lambda t: sum(token_positions[t]) / len(token_positions[t]))
    return " ".join(kept)

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

def phase2_extract(attempts: list, direct_attempts: list) -> dict:
    """Extract the passport fields by voting across all reliable reads."""
    today = date.today()
    good = [a for a in attempts if score_of(a) >= MIN_VALID_SCORE]
    notes = []
    # (b) right after `notes = []`: trusted direct reads (all 3 check digits passed)
    trusted = [a for a in direct_attempts
               if a["valid_number"] and a["valid_date_of_birth"] and a["valid_expiration_date"]]
    parsed_names = []
    for attempt in trusted:
        result = parse_name_line(attempt["line1"])
        if result:
            parsed_names.append({"surname": result[0], "names": result[1]})

    first_name = vote_name_tokens(parsed_names, "names")
    last_name = vote_name_tokens(parsed_names, "surname")
    if first_name is None or last_name is None:
        # Fallback: the previous behaviour (may contain OCR noise)
        first_name = first_name or vote_field(good, "names", transform=clean_text)
        last_name = last_name or vote_field(good, "surname", transform=clean_text)
        notes.append("name: direct reader gave no clean result, PassportEye value used (may be noisy)")

    nationality = (weighted_vote([(a["nationality"], 1) for a in trusted])
                   or vote_field(good, "nationality", transform=clean_text))
    # Names are parsed from MRZ line 1 itself, then voted across the clean reads
    parsed_names = []
    for attempt in attempts:
        first_line = str(attempt.get("raw_text") or "").split("\n")[0]
        result = parse_name_line(first_line)
        if result:
            parsed_names.append({"surname": result[0], "names": result[1]})

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
    # Names have no check digit; the raw (possibly noisy) value is kept and cleaned later
        "first_name": first_name,
        "last_name": last_name,
        "nationality": nationality,
        "passport_number": number,
        "date_of_birth": parse_mrz_date(dob_raw, True, today),
        "sex": vote_field(good, "sex", allowed=("M", "F")),
        "expiry_date": parse_mrz_date(exp_raw, False, today),
        "notes": notes,
    }

def _iso(value):
    """Dates become ISO strings; everything else passes through (None becomes null)."""
    return value.isoformat() if isinstance(value, date) else value
