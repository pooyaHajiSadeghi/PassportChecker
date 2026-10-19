"""Environment and API adapter. All analysis rules live in colleague_backend.py."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from app.config.settings import configure_tesseract
from app.core import mrz_engine as backend
from app.core import holder_extraction as extraction


class OutOfStandardPassportError(ValueError):
    pass

class UnexpectedSignatureError(ValueError):
    pass




def serialize_holder(data):
    """Map colleague output to widget keys without changing selected values."""
    if not data:
        return {}
    dob, expiry = data.get('date_of_birth'), data.get('expiry_date')
    holder = {
        'given_names': data.get('first_name'),
        'surname': data.get('last_name'),
        'father_name': data.get('father_name'),
        'issue_date': extraction._iso(data.get('issue_date')),
        'passport_number': data.get('passport_number'),
        'nationality': data.get('nationality'),
        'sex': data.get('sex'),
        'date_of_birth': dob.isoformat() if dob else None,
        'expiry_date': expiry.isoformat() if expiry else None,
        'date_of_birth_mrz': dob.strftime('%y%m%d') if dob else None,
        'expiration_date_mrz': expiry.strftime('%y%m%d') if expiry else None,
        'source': 'MRZ + printed OCR',
        'extraction_warnings': list(data.get('notes', [])),
        'name_verified': not any(str(n).startswith('name:') for n in data.get('notes', [])),
    }
    holder['full_name'] = ' '.join(filter(None, (holder['given_names'], holder['surname']))) or None
    return holder


def build_structured_result(approved, errors, data):
    """Colleague JSON schema, alongside the existing API keys for compatibility."""
    if not approved:
        return {'Passport': 'Not Valid', 'Reasons': list(errors)}
    if data is None:
        return {'Passport': 'Not Valid', 'Reasons': ['Extraction did not complete']}
    mapping = {'First name':'first_name', 'Last name':'last_name', "Father's name":'father_name',
               'Passport number':'passport_number', 'Nationality':'nationality', 'Date of birth':'date_of_birth',
               'Sex':'sex', 'Issue date':'issue_date', 'Expiry date':'expiry_date'}
    result = {'Passport': 'Valid'}
    result.update({label: extraction._iso(data.get(key)) for label, key in mapping.items()})
    if any(str(note).startswith('name:') for note in data.get('notes', [])):
        result['Warnings'] = [extraction.NAME_REVIEW_MESSAGE]
    return result


class PassportMRZChecker:
    def __init__(self):
        configure_tesseract()

    def check(self, pdf_path, progress_callback=None, force_phase2=False, page_number=1, check_callback=None):
        pdf = Path(pdf_path)
        if not pdf.is_file():
            raise FileNotFoundError(f'PDF not found: {pdf}')
        if not isinstance(page_number, int) or isinstance(page_number, bool) or page_number < 1:
            raise ValueError('Page number must be a positive integer')
        report = progress_callback or (lambda percent, message: None)
        report(5, 'Preparing passport analysis')
        attempts = backend.collect_mrz_attempts(pdf, progress_callback=report, page_index=page_number-1)
        if check_callback:
            check_callback(dict(id='reading', title='Document reading', state='pass', label='Completed', detail='All configured reading attempts finished. Validation follows; this does not confirm document authenticity or readability.'))
        report(85, 'Phase 1 · validating dates and signature')
        approved, errors, info = backend.phase1_validate(pdf, attempts, page_index=page_number-1, check_callback=check_callback)
        reliable = any(backend.score_of(a) >= backend.MIN_VALID_SCORE for a in attempts)
        data = None
        if (approved or force_phase2) and reliable:
            report(94, 'Phase 2 · extracting fields by voting across reliable reads')
            direct = extraction.collect_direct_attempts(pdf, page_index=page_number-1, progress_callback=report)
            data = extraction.phase2_extract(attempts, direct)
            data.update(extraction.extract_printed_fields(pdf, data['date_of_birth'], data['expiry_date'], page_index=page_number-1, progress_callback=report))
            name_unverified = any(str(note).startswith('name:') for note in data.get('notes', []))
            if name_unverified and extraction.NAME_UNVERIFIED_ACTION == 'reject':
                approved = False
                errors = [extraction.NAME_REJECT_MESSAGE]
        else:
            report(94, 'Validation finished · extraction skipped')
        if check_callback:
            check_callback(dict(id='extraction', title='Holder data extraction', state='pass' if data is not None else 'skipped', label='Completed' if data is not None else 'Skipped', detail='The extraction phase completed. Please verify the extracted fields against the passport.' if data is not None else 'Extraction was skipped because validation did not pass.'))
        analysis = dict(info)
        if 'best_valid_score' in analysis:
            analysis['valid_score'] = analysis.pop('best_valid_score')
        if 'age' in analysis:
            analysis['signature_required'] = analysis['age'] >= backend.ADULT_AGE
        return {
            'status': 'ok' if approved else ('out_of_standard' if not info else 'validation_error'),
            'approved': bool(approved),
            'message': 'Release' if approved else '; '.join(errors),
            'errors': list(errors),
            'analysis': analysis,
            'passport': serialize_holder(data),
            'result': build_structured_result(approved, errors, data),
            'extraction_performed': data is not None,
            'successful_mrz_reads': len(attempts),
            'force_phase2': bool(force_phase2),
            'page_number': page_number,
        }

    def check_or_raise(self, pdf_path):
        result = self.check(pdf_path)
        if not result['approved']:
            raise OutOfStandardPassportError(result['message'])
        return result


def evaluate_passport(checker, pdf_path):
    result = checker.check(pdf_path)
    return result['approved'], result['message']


def process_passport(pdf, subject, errors):
    ok, message = evaluate_passport(PassportMRZChecker(), pdf)
    if not ok:
        errors.append(f'{subject} : {message}')
    return pdf


def validate_document(pdf, subject='Passport', validation_errors=None):
    errors = validation_errors if validation_errors is not None else []
    process_passport(pdf, subject, errors)
    return {'route': None, 'errors': list(errors)}


