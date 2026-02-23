from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.database import Base


class CancellationLetter(Base):
    __tablename__ = "cancellation_letters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    anrede = Column(String(30), nullable=False)
    vorname = Column(String(100), nullable=False)
    nachname = Column(String(100), nullable=False)
    strasse = Column(String(200), nullable=False)
    plz = Column(String(10), nullable=False)
    ort = Column(String(100), nullable=False)
    geburtsdatum = Column(String(20), nullable=False)
    mitgliedsnummer = Column(String(50), nullable=True)
    abteilung = Column(String(200), nullable=True)
    austritt_datum = Column(String(20), nullable=False)
    signature_source = Column(String(30), nullable=False, default="none")
    filename = Column(String(500), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Optional denormalized field for display / future filters.
    display_name = Column(Text, nullable=True)
