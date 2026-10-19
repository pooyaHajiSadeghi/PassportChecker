"""Local HTTP adapter for the existing passport checker."""
from pathlib import Path
from tempfile import TemporaryDirectory, SpooledTemporaryFile
import logging
import threading

import pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config.settings import FRONTEND_DIR
from app.services.passport_service import PassportMRZChecker, configure_tesseract

app = FastAPI(title="Passport Checker API")
WEB = FRONTEND_DIR
app.mount("/static", StaticFiles(directory=WEB), name="static")
progress_context = threading.local()
analysis_lock = threading.Lock()
MAX_BYTES = 10 * 1024 * 1024


@app.get("/")
def home():
    return FileResponse(WEB / "index.html")


def response_for(result):
    # Preserve the public API contract; the colleague backend owns all decisions.
    return {key: result[key] for key in (
        'approved', 'message', 'analysis', 'passport', 'errors', 'result',
        'extraction_performed', 'successful_mrz_reads', 'page_number'
    )}


@app.post("/api/passport/check")
def check_passport(file: UploadFile = File(...), page_number: int | None = Form(None)):
    acquired = False
    try:
        if not file.filename or not file.filename.lower().endswith('.pdf'):
            raise HTTPException(400, 'Please upload a PDF file.')
        if not analysis_lock.acquire(blocking=False):
            raise HTTPException(503, 'The analyzer is busy. Please try again shortly.')
        acquired = True
        with TemporaryDirectory(prefix='passport_check_') as temporary:
            path = Path(temporary) / 'passport.pdf'
            size = 0
            with path.open('wb') as output:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, 'The PDF must be no larger than 10 MB.')
                    output.write(chunk)
            if not size:
                raise HTTPException(400, 'The PDF is empty.')
            try:
                with pymupdf.open(path) as doc:
                    if not doc.is_pdf or doc.needs_pass or doc.page_count < 1:
                        raise ValueError('Unreadable PDF')
                    if doc.page_count > 1 and page_number is None:
                        raise HTTPException(400, 'This PDF has multiple pages. Please select the passport page.')
                    selected_page = page_number if page_number is not None else 1
                    if selected_page < 1 or selected_page > doc.page_count:
                        raise HTTPException(400, f'Choose a page between 1 and {doc.page_count}.')
                    rect = doc[selected_page - 1].rect
                    if rect.width <= 0 or rect.height <= 0 or rect.height / rect.width > 5:
                        raise ValueError('Unsupported page dimensions')
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(400, 'Upload a readable, unencrypted PDF with standard page dimensions.') from exc
            try:
                configure_tesseract()
            except Exception as exc:
                raise HTTPException(503, 'The OCR service is not configured. Please contact the administrator.') from exc
            check_event = getattr(progress_context, "check_callback", None)
            if check_event:
                check_event(dict(id='upload', title='PDF preparation', state='pass', label='Completed', detail=f'PDF accepted. Passport page {selected_page} is ready for analysis.'))
            return response_for(PassportMRZChecker().check(path, progress_callback=getattr(progress_context, "callback", None), page_number=selected_page, check_callback=getattr(progress_context, "check_callback", None)))
    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).exception('Passport analysis failed')
        raise HTTPException(500, 'Passport analysis failed. Please try a different scan.') from exc
    finally:
        file.file.close()
        if acquired:
            analysis_lock.release()


@app.post("/api/passport/check/stream")
def check_passport_stream(file: UploadFile = File(...), page_number: int | None = Form(None)):
    """Stream measured OCR attempt progress, followed by the final result."""
    import json
    import queue
    from starlette.datastructures import UploadFile as BufferedUpload

    spool = SpooledTemporaryFile(max_size=1024 * 1024, mode='w+b')
    try:
        size = 0
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "The PDF must be no larger than 10 MB.")
            spool.write(chunk)
        spool.seek(0)
        buffered = BufferedUpload(file=spool, filename=file.filename)
    except BaseException:
        spool.close()
        raise
    finally:
        file.file.close()
    events = queue.Queue()

    def publish(percent, message):
        events.put({"type": "progress", "percent": percent, "message": message})

    def work():
        progress_context.callback = publish
        progress_context.check_callback = lambda item: events.put({"type": "check", "check": item})
        try:
            publish(2, "Validating uploaded PDF")
            result = check_passport(buffered, page_number=page_number)
            events.put({"type": "result", "result": result})
        except HTTPException as exc:
            events.put({"type": "error", "message": str(exc.detail)})
        except Exception:
            events.put({"type": "error", "message": "Analysis failed. Please try again."})
        finally:
            progress_context.callback = None
            progress_context.check_callback = None
            events.put(None)

    def stream():
        threading.Thread(target=work, daemon=True).start()
        while True:
            try:
                event = events.get(timeout=10)
            except queue.Empty:
                yield json.dumps({"type": "heartbeat"}) + "\n"
                continue
            if event is None:
                break
            yield json.dumps(event) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
