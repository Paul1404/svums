"""Document registry helpers.

Allocates unique, human-readable document IDs and records every generated PDF
so it can be identified later in the admin UI and re-downloaded by its ID.
"""
import logging
import secrets
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.generated_document import GeneratedDocument

logger = logging.getLogger(__name__)

DOC_TYPE_BEITRITT = "beitrittserklaerung"
DOC_TYPE_AUFNAHME = "aufnahmebestaetigung"
DOC_TYPE_KUENDIGUNG = "kuendigungsbestaetigung"

DOC_TYPE_LABELS = {
    DOC_TYPE_BEITRITT: "Beitrittserklärung",
    DOC_TYPE_AUFNAHME: "Aufnahmebestätigung",
    DOC_TYPE_KUENDIGUNG: "Austrittsbestätigung",
}

# Unambiguous alphabet (no 0/O/1/I/B/8) for codes that are read off paper.
_ALPHABET = "ACDEFGHJKLMNPQRSTUVWXYZ2345679"


def _random_code(length: int = 6) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def generate_document_id(db: Session) -> str:
    """Allocate a unique document ID, e.g. ``DOK-2026-7F3A9C``."""
    year = datetime.utcnow().year
    for _ in range(25):
        candidate = f"DOK-{year}-{_random_code()}"
        exists = (
            db.query(GeneratedDocument.id)
            .filter(GeneratedDocument.document_id == candidate)
            .first()
        )
        if not exists:
            return candidate
    raise RuntimeError("Konnte keine eindeutige Dokument-ID vergeben")


def record_document(
    db: Session,
    *,
    document_id: str,
    doc_type: str,
    storage_filename: str,
    application_id: int | None = None,
    cancellation_letter_id: int | None = None,
    recipient_name: str | None = None,
) -> GeneratedDocument:
    """Persist a registry row for a generated document (does not commit)."""
    doc = GeneratedDocument(
        document_id=document_id,
        doc_type=doc_type,
        storage_filename=storage_filename,
        application_id=application_id,
        cancellation_letter_id=cancellation_letter_id,
        recipient_name=recipient_name,
    )
    db.add(doc)
    db.flush()
    logger.info("Recorded document %s (%s) -> %s", document_id, doc_type, storage_filename)
    return doc
