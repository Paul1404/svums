"""OCR service for extracting text from uploaded paper-form scans.

Used by the admin to read handwritten/printed text on a scanned
Beitrittserklärung alongside the preview. The recognized text is offered to
the admin to copy-paste into the transcription form — there is no automatic
field detection or auto-fill.

Tesseract (`tesseract-ocr` + `tesseract-ocr-deu` language pack) is required at
runtime. When the binary is missing, ``extract_text`` returns ``None`` so the
rest of the app keeps working — the UI then displays a "nicht verfügbar"
notice.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Render PDFs at this DPI before OCR. 200 is the standard sweet spot:
# below 150 Tesseract loses accuracy on small handwriting, above 300 the
# extra pixels cost time without improving recognition.
_PDF_RENDER_DPI = 200

# Cap how many PDF pages we OCR — pathologically long scans would otherwise
# hang the admin's request. The Beitrittserklärung is one page; we allow a
# small buffer for multi-page submissions.
_PDF_MAX_PAGES = 6

_TESSERACT_LANGS = "deu+eng"


def is_available() -> bool:
    """Best-effort probe of whether OCR can run in this process."""
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception:
        return False
    try:
        import pytesseract as _pt
        _pt.get_tesseract_version()
    except Exception:
        return False
    return True


def extract_text(content: bytes, filename: str) -> str | None:
    """Run OCR on the given file bytes.

    Returns the recognized text (may be empty string for blank/illegible scans)
    or ``None`` if OCR is unavailable in this environment. Errors during
    rendering of individual PDF pages are logged but do not abort the whole
    extraction — the function returns whatever was successfully OCR'd.
    """
    if not content:
        return ""

    try:
        import pytesseract
        from PIL import Image
    except Exception as e:
        logger.warning("OCR dependencies missing: %s", e)
        return None

    ext = Path(filename or "").suffix.lower()

    try:
        if ext == ".pdf":
            return _ocr_pdf(content, pytesseract=pytesseract, Image=Image)
        return _ocr_image(content, pytesseract=pytesseract, Image=Image)
    except FileNotFoundError as e:
        # pytesseract raises this when the tesseract binary is missing.
        logger.warning("tesseract binary not found: %s", e)
        return None
    except Exception as e:
        logger.exception("OCR failed: %s", e)
        return None


def _ocr_image(content: bytes, *, pytesseract, Image) -> str:
    img = Image.open(io.BytesIO(content))
    # Force a known mode — Tesseract accepts most modes but some PIL plugins
    # decode in 'P' or 'CMYK' which Tesseract handles poorly.
    if img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    text = pytesseract.image_to_string(img, lang=_TESSERACT_LANGS)
    return text.strip()


def _ocr_pdf(content: bytes, *, pytesseract, Image) -> str:
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        logger.warning("PyMuPDF missing — cannot OCR PDFs: %s", e)
        return ""

    parts: list[str] = []
    with fitz.open(stream=content, filetype="pdf") as doc:
        pages = min(len(doc), _PDF_MAX_PAGES)
        for i in range(pages):
            try:
                page = doc[i]
                # First try to pull any embedded text layer — many "scanned"
                # PDFs from modern scanners already contain searchable text.
                embedded = (page.get_text() or "").strip()
                if embedded:
                    parts.append(embedded)
                    continue
                pix = page.get_pixmap(dpi=_PDF_RENDER_DPI, alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                text = pytesseract.image_to_string(img, lang=_TESSERACT_LANGS)
                parts.append(text.strip())
            except Exception as e:
                logger.warning("OCR failed on page %d: %s", i, e)
    return "\n\n".join(p for p in parts if p)
