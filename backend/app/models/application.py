import json
import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Date, DateTime, Boolean, Text, Numeric
from app.database import Base


class MembershipApplication(Base):
    __tablename__ = "membership_applications"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Application reference
    antragsnummer = Column(String(20), nullable=True, unique=True)
    upload_token = Column(String(36), nullable=True, unique=True, default=lambda: str(uuid.uuid4()))

    # Application type: einzel, kind, familie
    antragstyp = Column(String(20), nullable=False, default="einzel")

    # Personal data (applicant / parent for Familie / child for Kind)
    geschlecht = Column(String(20), nullable=True)  # "Herr", "Frau", or "keine Angabe"
    vorname = Column(String(100), nullable=False)
    nachname = Column(String(100), nullable=False)
    geburtsdatum = Column(Date, nullable=False)
    strasse = Column(String(200), nullable=False)
    plz = Column(String(10), nullable=False)
    ort = Column(String(100), nullable=False)
    telefon = Column(String(50), nullable=True)
    email = Column(String(200), nullable=False)

    # Guardian (only for Kind type)
    erziehungsberechtigter_vorname = Column(String(100), nullable=True)
    erziehungsberechtigter_nachname = Column(String(100), nullable=True)

    # Partner / second parent (only for Familie type)
    partner_vorname = Column(String(100), nullable=True)
    partner_nachname = Column(String(100), nullable=True)
    partner_geburtsdatum = Column(Date, nullable=True)
    partner_abteilungen = Column(Text, nullable=True)  # JSON array

    # Children (only for Familie type, JSON array)
    kinder = Column(Text, nullable=True)  # JSON: [{vorname, nachname, geburtsdatum, abteilungen}]

    # Membership
    abteilungen = Column(Text, nullable=False, default="[]")  # JSON array
    mitgliedschaft_typ = Column(String(30), nullable=False)
    elternteil_mitglied = Column(Boolean, nullable=True)
    jahresbeitrag = Column(Numeric(10, 2), nullable=False)

    # SEPA
    kontoinhaber = Column(String(200), nullable=True)
    iban = Column(String(34), nullable=False)
    bic = Column(String(11), nullable=True)
    kreditinstitut = Column(String(200), nullable=True)
    mandatsreferenz = Column(String(30), nullable=True, unique=True)

    # Status & metadata
    status = Column(String(20), nullable=False, default="neu")
    notes = Column(Text, nullable=True)
    email_sent = Column(Boolean, nullable=False, default=False)
    uploaded_file = Column(String(500), nullable=True)  # path to uploaded signed document
    uploaded_at = Column(DateTime, nullable=True)
    consent_at = Column(DateTime, nullable=True)  # GDPR consent timestamp
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    def get_abteilungen(self) -> list[str]:
        try:
            return json.loads(self.abteilungen)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_abteilungen(self, value: list[str]):
        self.abteilungen = json.dumps(value)

    def get_kinder(self) -> list[dict]:
        try:
            return json.loads(self.kinder) if self.kinder else []
        except (json.JSONDecodeError, TypeError):
            return []

    def set_kinder(self, value: list[dict]):
        self.kinder = json.dumps(value, default=str)

    def get_partner_abteilungen(self) -> list[str]:
        try:
            return json.loads(self.partner_abteilungen) if self.partner_abteilungen else []
        except (json.JSONDecodeError, TypeError):
            return []

    def set_partner_abteilungen(self, value: list[str]):
        self.partner_abteilungen = json.dumps(value)

    @property
    def full_name(self) -> str:
        return f"{self.nachname}, {self.vorname}"
