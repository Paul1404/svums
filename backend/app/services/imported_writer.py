"""
Writes data parsed from a Linear Webverein dump into our ``lw_*`` tables.

Imports are idempotent on (AdrNr, MandatsNr) and (AdrNr, VertragNr, Art):
re-importing the same dump replaces existing rows rather than duplicating
them, so admins can re-upload a fresh backup at any time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.imported import (
    LwContract,
    LwFeeType,
    LwImportBatch,
    LwMember,
    LwSepaMandate,
)
from app.services.crypto import encrypt_iban
from app.services.sql_import import (
    ParsedDump,
    coerce_bool,
    coerce_date,
    coerce_decimal,
    coerce_int,
    coerce_str,
    row_to_dict,
)

logger = logging.getLogger(__name__)


@dataclass
class WriteSummary:
    members: int = 0
    contracts: int = 0
    fee_types: int = 0
    sepa: int = 0
    parsed_tables: list[str] = None
    skipped_tables: list[str] = None

    def __post_init__(self):
        if self.parsed_tables is None:
            self.parsed_tables = []
        if self.skipped_tables is None:
            self.skipped_tables = []


def write_dump(
    db: Session,
    dump: ParsedDump,
    *,
    filename: str | None,
    file_size_bytes: int | None,
) -> tuple[LwImportBatch, WriteSummary]:
    """Persist the parsed dump and return the import batch + summary.

    The batch is committed before rows are inserted so foreign-key references
    are valid even if a later step fails.
    """
    summary = WriteSummary()

    batch = LwImportBatch(
        filename=filename,
        file_size_bytes=file_size_bytes,
    )
    db.add(batch)
    db.flush()

    if "mgart" in dump.columns:
        summary.fee_types = _write_fee_types(db, dump, batch.id)
        summary.parsed_tables.append("mgart")
    if "adresse" in dump.columns:
        summary.members = _write_members(db, dump, batch.id)
        summary.parsed_tables.append("adresse")
    if "mgvert" in dump.columns:
        summary.contracts = _write_contracts(db, dump, batch.id)
        summary.parsed_tables.append("mgvert")
    if "adrsepa" in dump.columns:
        summary.sepa = _write_sepa(db, dump, batch.id)
        summary.parsed_tables.append("adrsepa")

    batch.members_count = summary.members
    batch.contracts_count = summary.contracts
    batch.fee_types_count = summary.fee_types
    batch.sepa_count = summary.sepa
    batch.skipped_tables = ",".join(sorted(summary.skipped_tables)) if summary.skipped_tables else None
    db.commit()
    return batch, summary


def _write_fee_types(db: Session, dump: ParsedDump, batch_id: int) -> int:
    cols = dump.columns["mgart"]
    rows = dump.rows.get("mgart", [])
    existing = {ft.art: ft for ft in db.query(LwFeeType).all()}
    written = 0
    for raw in rows:
        d = row_to_dict(cols, raw)
        art = coerce_int(d.get("Art"))
        if art is None:
            continue
        ft = existing.get(art)
        if ft is None:
            ft = LwFeeType(art=art)
            db.add(ft)
            existing[art] = ft
        ft.bezeichnung = coerce_str(d.get("Bezeichnung"), 150)
        ft.sollstellung = coerce_str(d.get("Sollstellung"), 20)
        ft.betrag = coerce_decimal(d.get("Betrag1"))
        ft.fibukonto = coerce_int(d.get("Fibukonto"))
        ft.nicht_aktiv = _yn_to_bool(d.get("NichAktiv"))
        ft.batch_id = batch_id
        written += 1
    db.flush()
    return written


def _write_members(db: Session, dump: ParsedDump, batch_id: int) -> int:
    cols = dump.columns["adresse"]
    rows = dump.rows.get("adresse", [])
    existing = {m.adr_nr: m for m in db.query(LwMember).all()}
    written = 0
    for raw in rows:
        d = row_to_dict(cols, raw)
        adr_nr = coerce_int(d.get("AdrNr"))
        if adr_nr is None:
            continue
        m = existing.get(adr_nr)
        if m is None:
            m = LwMember(adr_nr=adr_nr)
            db.add(m)
            existing[adr_nr] = m
        m.mitgliedsnummer = coerce_str(d.get("MITGLNR"), 50)
        m.anrede = coerce_str(d.get("Anrede"), 40)
        m.titel = coerce_str(d.get("Titel1"), 60) or coerce_str(d.get("Anredetitel"), 60)
        m.vorname = coerce_str(d.get("Vorname"), 100)
        m.nachname = coerce_str(d.get("Nachname"), 100)
        m.geborene = coerce_str(d.get("Geborene"), 80)
        m.geburtsdatum = coerce_date(d.get("Geburtsdatum"))
        m.geburtsort = coerce_str(d.get("Geburtsort"), 80)
        m.strasse = coerce_str(d.get("Strasse"), 200)
        m.hausnummer = coerce_str(d.get("Hausnummer"), 20)
        m.plz = coerce_str(d.get("PLZ"), 15)
        m.ort = coerce_str(d.get("Ort"), 80)
        m.land = coerce_str(d.get("Land"), 100)
        m.co = coerce_str(d.get("co"), 120)
        m.telefon = coerce_str(d.get("Telefon1"), 60)
        m.telefon_mobil = coerce_str(d.get("Telefon2"), 60)
        # Linear Webverein puts email in either Telefon3 or EMailName depending on era
        email = coerce_str(d.get("Telefon3"), 250) or coerce_str(d.get("EMailName"), 250)
        m.email = email
        m.eintritt = coerce_date(d.get("Eintritt"))
        m.austritt = coerce_date(d.get("Austritt"))
        m.verstorben_am = coerce_date(d.get("VerstorbenAm"))
        m.aktiv = coerce_str(d.get("Aktiv"), 1)
        m.aktiv_pasiv = coerce_str(d.get("AktivPasiv"), 1)
        m.bereich = coerce_str(d.get("Bereich"), 40)
        m.abteilung = coerce_str(d.get("Abteilung"), 80)
        m.bank = coerce_str(d.get("Bank1"), 150)
        iban = coerce_str(d.get("IBAN1"), 35)
        m.iban = encrypt_iban(iban) if iban else None
        m.bic = coerce_str(d.get("BIC1"), 40)
        m.abw_kontoinhaber = coerce_str(d.get("AbwKontoInh"), 80)
        m.mandatsreferenz = coerce_str(d.get("mandatsrefenz"), 50) or coerce_str(d.get("Mandatsreferenz"), 50)
        m.geloscht = coerce_bool(d.get("Geloscht"))
        m.batch_id = batch_id
        written += 1
    db.flush()
    return written


def _write_contracts(db: Session, dump: ParsedDump, batch_id: int) -> int:
    cols = dump.columns["mgvert"]
    rows = dump.rows.get("mgvert", [])
    # Replace all contracts in one go — they're cheap and have no natural PK
    # we can rely on across re-imports.
    db.query(LwContract).delete(synchronize_session=False)
    db.flush()
    valid_adr_nrs = {r[0] for r in db.query(LwMember.adr_nr).all()}
    written = 0
    for raw in rows:
        d = row_to_dict(cols, raw)
        adr_nr = coerce_int(d.get("AdrNr"))
        if adr_nr is None or adr_nr not in valid_adr_nrs:
            continue
        c = LwContract(
            adr_nr=adr_nr,
            vertrag_nr=coerce_str(d.get("VertragNr"), 20),
            art=coerce_int(d.get("Art")),
            art_name=coerce_str(d.get("ArtName"), 150),
            mitglied_nr=coerce_str(d.get("MitglNr"), 50),
            sollstellung=coerce_str(d.get("Sollstellung"), 20),
            vertrag_begin=coerce_date(d.get("VertragBegin")),
            vertrag_ende=coerce_date(d.get("VertragEnde")),
            betrag=coerce_decimal(d.get("Betrag")),
            gekuend_am=coerce_date(d.get("GekuendAm")),
            gekuend_zum=coerce_date(d.get("GekuendZum")),
            batch_id=batch_id,
        )
        db.add(c)
        written += 1
    db.flush()
    return written


def _write_sepa(db: Session, dump: ParsedDump, batch_id: int) -> int:
    cols = dump.columns["adrsepa"]
    rows = dump.rows.get("adrsepa", [])
    db.query(LwSepaMandate).delete(synchronize_session=False)
    db.flush()
    valid_adr_nrs = {r[0] for r in db.query(LwMember.adr_nr).all()}
    written = 0
    for raw in rows:
        d = row_to_dict(cols, raw)
        adr_nr = coerce_int(d.get("AdrNr"))
        if adr_nr is None or adr_nr not in valid_adr_nrs:
            continue
        s = LwSepaMandate(
            adr_nr=adr_nr,
            mandats_nr=coerce_str(d.get("MandatsNr"), 50),
            lastschriftart=coerce_str(d.get("Lastschriftart"), 30),
            status=coerce_str(d.get("Status"), 30),
            angelegt_am=coerce_date(d.get("AngelegtAm")),
            gueltig_ab=coerce_date(d.get("GueltigAb")),
            gueltig_bis=coerce_date(d.get("GultigBis")),
            unterschrift_datum=coerce_date(d.get("UnterschriftDatum")),
            erste_verwendung=coerce_date(d.get("ErsteVerwendung")),
            letzte_verwendung=coerce_date(d.get("LetzteVerwendung")),
            widerrufen_am=coerce_date(d.get("WiderrufenAm")),
            is_deleted=coerce_bool(d.get("IsDeleted")),
            batch_id=batch_id,
        )
        db.add(s)
        written += 1
    db.flush()
    return written


def _yn_to_bool(value) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    s = str(value).strip().upper()
    if s in ("Y", "J", "1", "TRUE"):
        return True
    if s in ("N", "0", "FALSE"):
        return False
    return None
