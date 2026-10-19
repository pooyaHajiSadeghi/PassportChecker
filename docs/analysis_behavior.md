# Analysis behavior

## Processing

1. Validate a non-empty PDF upload (maximum 10 MiB) and the selected page. Multi-page PDFs require an explicit page selection.
2. Read MRZ using PassportEye and Tesseract across seven requested widths and two crops (full page and lower half). Rendering is limited by the configured pixel budget.
3. Keep reliable MRZ reads with a score of at least 50 and parseable dates.
4. Apply the existing validity and signature rules.
5. Extract holder information only after approval in normal API operation.

## Existing validation rules

- More than 18 whole months of remaining validity are required.
- Holders aged 18 or older require a signature identified as blue.
- Holders under 18 must not have a signature under the configured rule.
- Signature analysis uses a fixed page region; the scan layout affects detection.
- These checks do not establish document authenticity.

## Extraction

Names now use the approved independent Tesseract reader and strict majority voting, with PassportEye fallback and a review warning. Other fields use the approved extraction voting rules. Passport number and dates prefer valid check digits; fallback results receive warnings. Names have no check digit. Returned holder fields: given names, surname, passport number, nationality code, sex, date of birth and expiry date. Father's name and issue date are extracted from printed OCR; see extraction_update.md. Dates are serialized as YYYY-MM-DD.

## Stream events

The NDJSON endpoint sends progress, check, heartbeat, result and error events. Check IDs are upload, reading, validity, signature, ink and extraction. Upload and reading completion describe processing stages, not passport approval. Signature and ink results can arrive together because they share one analysis operation. The frontend keeps completed checks visible while processing continues.

## Configuration

Edit config/.env, starting from config/.env.example. TESSERACT_CMD selects the OCR executable. TESSDATA_PREFIX can select language data. MAX_RENDER_PIXELS and MAX_RENDER_SIDE bound raster dimensions. The default pixel budget is 12 million and the maximum side is 6000. A lower rendering budget trades image detail for memory use.
