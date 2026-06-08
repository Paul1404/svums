from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from app.database import Base


class GeneratedDocument(Base):
    """Registry of every generated PDF document.

    Each row carries a unique, human-readable ``document_id`` that is printed in
    the corner of the PDF and used to identify the document in the admin UI.
    """

    __tablename__ = "generated_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String(40), nullable=False, unique=True, index=True)
    # beitrittserklaerung | aufnahmebestaetigung | kuendigungsbestaetigung
    doc_type = Column(String(40), nullable=False)
    application_id = Column(Integer, nullable=True, index=True)
    cancellation_letter_id = Column(Integer, nullable=True, index=True)
    storage_filename = Column(String(500), nullable=False)
    recipient_name = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
