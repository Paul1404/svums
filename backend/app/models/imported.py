"""
Models for data imported from Linear Webverein SQL dumps.

These tables are kept separate from the application/membership_applications
tables on purpose: the imported data is a read-only mirror of the club's
existing membership management system and must not interfere with the
online application workflow.

Tables are prefixed with ``lw_`` (Linear Webverein) to make their origin
obvious in the database.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Date, DateTime, Boolean, Text, Numeric, ForeignKey

from app.database import Base


class LwImportBatch(Base):
    __tablename__ = "lw_import_batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(500), nullable=True)
    imported_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    file_size_bytes = Column(Integer, nullable=True)
    members_count = Column(Integer, nullable=False, default=0)
    contracts_count = Column(Integer, nullable=False, default=0)
    fee_types_count = Column(Integer, nullable=False, default=0)
    sepa_count = Column(Integer, nullable=False, default=0)
    skipped_tables = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)


class LwMember(Base):
    """One person record from Linear Webverein's ``adresse`` table.

    The original primary key (``AdrNr``) is preserved so contracts and SEPA
    mandates can reference it. IBAN values are stored encrypted at rest
    using the same Fernet helper as the application table.
    """

    __tablename__ = "lw_members"

    adr_nr = Column(Integer, primary_key=True)
    mitgliedsnummer = Column(String(50), nullable=True, index=True)
    anrede = Column(String(40), nullable=True)
    titel = Column(String(60), nullable=True)
    vorname = Column(String(100), nullable=True)
    nachname = Column(String(100), nullable=True)
    geborene = Column(String(80), nullable=True)
    geburtsdatum = Column(Date, nullable=True)
    geburtsort = Column(String(80), nullable=True)
    strasse = Column(String(200), nullable=True)
    hausnummer = Column(String(20), nullable=True)
    plz = Column(String(15), nullable=True)
    ort = Column(String(80), nullable=True)
    land = Column(String(100), nullable=True)
    co = Column(String(120), nullable=True)
    telefon = Column(String(60), nullable=True)
    telefon_mobil = Column(String(60), nullable=True)
    email = Column(String(250), nullable=True, index=True)
    eintritt = Column(Date, nullable=True)
    austritt = Column(Date, nullable=True)
    verstorben_am = Column(Date, nullable=True)
    aktiv = Column(String(1), nullable=True)
    aktiv_pasiv = Column(String(1), nullable=True)
    bereich = Column(String(40), nullable=True)
    abteilung = Column(String(80), nullable=True)
    bank = Column(String(150), nullable=True)
    iban = Column(String(500), nullable=True)
    bic = Column(String(40), nullable=True)
    abw_kontoinhaber = Column(String(80), nullable=True)
    mandatsreferenz = Column(String(50), nullable=True)
    geloscht = Column(Boolean, nullable=True, default=False)
    bemerkung = Column(Text, nullable=True)
    imported_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    batch_id = Column(Integer, ForeignKey("lw_import_batches.id", ondelete="SET NULL"), nullable=True)

    @property
    def full_name(self) -> str:
        parts = [p for p in (self.vorname, self.nachname) if p]
        return " ".join(parts) if parts else f"AdrNr {self.adr_nr}"


class LwFeeType(Base):
    """A contribution / fee type from ``mgart``."""

    __tablename__ = "lw_fee_types"

    art = Column(Integer, primary_key=True)
    bezeichnung = Column(String(150), nullable=True)
    sollstellung = Column(String(20), nullable=True)
    betrag = Column(Numeric(12, 2), nullable=True)
    fibukonto = Column(Integer, nullable=True)
    nicht_aktiv = Column(Boolean, nullable=True, default=False)
    batch_id = Column(Integer, ForeignKey("lw_import_batches.id", ondelete="SET NULL"), nullable=True)


class LwContract(Base):
    """A membership contract row from ``mgvert``."""

    __tablename__ = "lw_contracts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    adr_nr = Column(Integer, ForeignKey("lw_members.adr_nr", ondelete="CASCADE"), nullable=False, index=True)
    vertrag_nr = Column(String(20), nullable=True)
    art = Column(Integer, nullable=True)
    art_name = Column(String(150), nullable=True)
    mitglied_nr = Column(String(50), nullable=True)
    sollstellung = Column(String(20), nullable=True)
    vertrag_begin = Column(Date, nullable=True)
    vertrag_ende = Column(Date, nullable=True)
    betrag = Column(Numeric(12, 2), nullable=True)
    gekuend_am = Column(Date, nullable=True)
    gekuend_zum = Column(Date, nullable=True)
    batch_id = Column(Integer, ForeignKey("lw_import_batches.id", ondelete="SET NULL"), nullable=True)


class LwSepaMandate(Base):
    """A SEPA mandate row from ``adrsepa``."""

    __tablename__ = "lw_sepa_mandates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    adr_nr = Column(Integer, ForeignKey("lw_members.adr_nr", ondelete="CASCADE"), nullable=False, index=True)
    mandats_nr = Column(String(50), nullable=True)
    lastschriftart = Column(String(30), nullable=True)
    status = Column(String(30), nullable=True)
    angelegt_am = Column(Date, nullable=True)
    gueltig_ab = Column(Date, nullable=True)
    gueltig_bis = Column(Date, nullable=True)
    unterschrift_datum = Column(Date, nullable=True)
    erste_verwendung = Column(Date, nullable=True)
    letzte_verwendung = Column(Date, nullable=True)
    widerrufen_am = Column(Date, nullable=True)
    is_deleted = Column(Boolean, nullable=True, default=False)
    batch_id = Column(Integer, ForeignKey("lw_import_batches.id", ondelete="SET NULL"), nullable=True)
