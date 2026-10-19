# Approved colleague extraction integration

The effective extraction functions from Passport_Check.py are in app/core/holder_extraction.py. The existing validation engine and rules remain unchanged. The approved extraction logic uses PassportEye reads, an independent direct Tesseract MRZ reader, and printed-field OCR for father's name and issue date. Direct OCR runs during the extraction phase after validation, avoiding unnecessary work for rejected passports. Its selected values are unchanged for identical OCR inputs.

All readers use the user-selected PDF page and the existing bounded raster renderer. The additional OCR work adds processing time. Printed-field OCR assumes the data page occupies the lower 60% of the selected page, as in the colleague code. Father's-name OCR can be imperfect; missing fields remain null. Issue-date selection uses the colleague's date elimination and vote rules. Name verification uses the colleague's default review policy; it is not identity or authenticity verification.

The API preserves existing keys and adds result with the colleague schema (Passport, First name, Last name, Father's name, Passport number, Nationality, Date of birth, Sex, Issue date, Expiry date, and optional Warnings or Reasons). passport also gains father_name, issue_date and name_verified. The frontend displays the extra fields and warnings and downloads the structured result locally as JSON. No extra server-side JSON or uploaded PDF files are retained.

Install/update dependencies with the platform setup script, restart the server and hard refresh the browser. Normal CLI output remains the complete API envelope; result contains the concise colleague JSON.

## Validation performed

Dependency-free unit tests cover name cleanup/strict majority, printed-field parsing, ambiguous issue dates, selected-page forwarding, structured output, rejection and extraction skipping. Effective extraction decision functions were compared against the supplied colleague source; trusted and fallback fixtures match. Python compilation and JavaScript syntax checks pass. Full OCR execution and browser visual QA were not run in the editing environment. Run `python -m unittest discover -s tests -v` for the included logic tests.
