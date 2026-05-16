"""
Admin endpoints for importing and browsing Linear Webverein data.

Mounted under ``/api/admin/imports``. All endpoints require an admin
session cookie. The actual data lives in tables prefixed ``lw_`` and is
strictly separated from the online membership-application workflow.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.imported import (
    LwContract,
    LwFeeType,
    LwImportBatch,
    LwMember,
    LwSepaMandate,
)
from app.routers.admin import require_admin
from app.schemas.imported import (
    LwFeeTypeResponse,
    LwImportBatchResponse,
    LwImportResult,
    LwImportStatsResponse,
    LwMemberDetailResponse,
    LwMemberListResponse,
    LwMemberSummary,
)
from app.services.crypto import decrypt_iban_safe
from app.services.imported_writer import write_dump
from app.services.sql_import import SUPPORTED_TABLES, parse_dump

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/imports", tags=["admin-imports"])

# 50 MB cap — the sample dump is ~4 MB. Generous headroom for clubs with
# more members but small enough to prevent abuse.
MAX_SQL_UPLOAD_BYTES = 50 * 1024 * 1024


@router.post("/sql", response_model=LwImportResult)
async def upload_sql(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    """Upload a Linear Webverein MySQL dump (.sql) and import its data."""
    filename = file.filename or "import.sql"
    if not filename.lower().endswith(".sql"):
        raise HTTPException(status_code=400, detail="Bitte eine .sql-Datei hochladen.")

    contents = await file.read()
    size = len(contents)
    if size == 0:
        raise HTTPException(status_code=400, detail="Leere Datei.")
    if size > MAX_SQL_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Datei zu groß. Maximum {MAX_SQL_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    # The dump is UTF-8 text but may contain raw binary blob data inline
    # (e.g. ``mediumblob`` photo columns). ``errors='replace'`` keeps byte
    # offsets stable; the text columns we actually read are pure UTF-8.
    text = contents.decode("utf-8", errors="replace")

    if "INSERT INTO" not in text and "CREATE TABLE" not in text:
        raise HTTPException(
            status_code=400,
            detail="Datei sieht nicht wie ein SQL-Dump aus (keine CREATE TABLE / INSERT-Anweisungen).",
        )

    logger.info("SQL import started: file=%s size=%d bytes", filename, size)
    dump = parse_dump(text)
    if not any(dump.rows.get(t) for t in SUPPORTED_TABLES):
        raise HTTPException(
            status_code=400,
            detail=(
                "Im Dump wurden keine bekannten Tabellen gefunden. "
                "Unterstützt werden: adresse, mgart, mgvert, adrsepa."
            ),
        )

    batch, summary = write_dump(db, dump, filename=filename, file_size_bytes=size)
    logger.info(
        "SQL import done: batch=%d members=%d contracts=%d sepa=%d fee_types=%d",
        batch.id, summary.members, summary.contracts, summary.sepa, summary.fee_types,
    )

    return LwImportResult(
        batch=LwImportBatchResponse.model_validate(batch),
        inserted_members=summary.members,
        inserted_contracts=summary.contracts,
        inserted_fee_types=summary.fee_types,
        inserted_sepa=summary.sepa,
        parsed_tables=summary.parsed_tables,
        skipped_tables=summary.skipped_tables,
    )


@router.get("/stats", response_model=LwImportStatsResponse)
async def import_stats(
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    """Counters for the admin dashboard imported-data widget."""
    total_members = db.query(func.count(LwMember.adr_nr)).scalar() or 0
    deleted_members = (
        db.query(func.count(LwMember.adr_nr))
        .filter(LwMember.geloscht.is_(True))
        .scalar()
        or 0
    )
    active_members = (
        db.query(func.count(LwMember.adr_nr))
        .filter(
            or_(LwMember.geloscht.is_(False), LwMember.geloscht.is_(None)),
            or_(LwMember.austritt.is_(None), LwMember.austritt > func.current_date()),
            LwMember.verstorben_am.is_(None),
        )
        .scalar()
        or 0
    )
    total_contracts = db.query(func.count(LwContract.id)).scalar() or 0
    total_sepa = db.query(func.count(LwSepaMandate.id)).scalar() or 0
    total_fee_types = db.query(func.count(LwFeeType.art)).scalar() or 0
    last_batch = (
        db.query(LwImportBatch).order_by(LwImportBatch.imported_at.desc()).first()
    )
    return LwImportStatsResponse(
        total_members=total_members,
        active_members=active_members,
        deleted_members=deleted_members,
        total_contracts=total_contracts,
        total_sepa=total_sepa,
        total_fee_types=total_fee_types,
        last_import=LwImportBatchResponse.model_validate(last_batch) if last_batch else None,
    )


@router.get("/members", response_model=LwMemberListResponse)
async def list_members(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    include_deleted: bool = Query(False),
    include_resigned: bool = Query(True),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    query = db.query(LwMember)
    if not include_deleted:
        query = query.filter(or_(LwMember.geloscht.is_(False), LwMember.geloscht.is_(None)))
    if not include_resigned:
        query = query.filter(
            or_(LwMember.austritt.is_(None), LwMember.austritt > func.current_date())
        )
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                LwMember.nachname.ilike(like),
                LwMember.vorname.ilike(like),
                LwMember.email.ilike(like),
                LwMember.mitgliedsnummer.ilike(like),
                LwMember.ort.ilike(like),
                LwMember.plz.ilike(like),
            )
        )
    total = query.count()
    items = (
        query.order_by(LwMember.nachname.asc().nullslast(), LwMember.vorname.asc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return LwMemberListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[LwMemberSummary.model_validate(m) for m in items],
    )


@router.get("/members/{adr_nr}", response_model=LwMemberDetailResponse)
async def get_member(
    adr_nr: int,
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    m = db.query(LwMember).filter(LwMember.adr_nr == adr_nr).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mitglied nicht gefunden")

    contracts = (
        db.query(LwContract)
        .filter(LwContract.adr_nr == adr_nr)
        .order_by(LwContract.vertrag_begin.desc().nullslast())
        .all()
    )
    sepa = (
        db.query(LwSepaMandate)
        .filter(LwSepaMandate.adr_nr == adr_nr)
        .order_by(LwSepaMandate.angelegt_am.desc().nullslast())
        .all()
    )

    payload = {
        "adr_nr": m.adr_nr,
        "mitgliedsnummer": m.mitgliedsnummer,
        "anrede": m.anrede,
        "titel": m.titel,
        "vorname": m.vorname,
        "nachname": m.nachname,
        "geborene": m.geborene,
        "geburtsdatum": m.geburtsdatum,
        "geburtsort": m.geburtsort,
        "strasse": m.strasse,
        "hausnummer": m.hausnummer,
        "plz": m.plz,
        "ort": m.ort,
        "land": m.land,
        "co": m.co,
        "telefon": m.telefon,
        "telefon_mobil": m.telefon_mobil,
        "email": m.email,
        "eintritt": m.eintritt,
        "austritt": m.austritt,
        "verstorben_am": m.verstorben_am,
        "aktiv": m.aktiv,
        "aktiv_pasiv": m.aktiv_pasiv,
        "bereich": m.bereich,
        "abteilung": m.abteilung,
        "bank": m.bank,
        "iban": decrypt_iban_safe(m.iban) if m.iban else None,
        "bic": m.bic,
        "abw_kontoinhaber": m.abw_kontoinhaber,
        "mandatsreferenz": m.mandatsreferenz,
        "geloscht": m.geloscht,
        "bemerkung": m.bemerkung,
        "imported_at": m.imported_at,
        "contracts": contracts,
        "sepa_mandates": sepa,
    }
    return LwMemberDetailResponse.model_validate(payload)


@router.get("/fee-types", response_model=list[LwFeeTypeResponse])
async def list_fee_types(
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    items = db.query(LwFeeType).order_by(LwFeeType.art.asc()).all()
    return [LwFeeTypeResponse.model_validate(i) for i in items]


@router.get("/batches", response_model=list[LwImportBatchResponse])
async def list_batches(
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    items = (
        db.query(LwImportBatch).order_by(LwImportBatch.imported_at.desc()).limit(20).all()
    )
    return [LwImportBatchResponse.model_validate(i) for i in items]


@router.delete("/data")
async def purge_imported_data(
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    """Wipe all imported data so a fresh dump can be loaded from scratch."""
    db.query(LwSepaMandate).delete(synchronize_session=False)
    db.query(LwContract).delete(synchronize_session=False)
    db.query(LwMember).delete(synchronize_session=False)
    db.query(LwFeeType).delete(synchronize_session=False)
    db.query(LwImportBatch).delete(synchronize_session=False)
    db.commit()
    logger.info("All imported Linear Webverein data purged by admin")
    return {"ok": True}
