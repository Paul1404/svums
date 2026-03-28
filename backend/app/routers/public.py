import json
import logging
import os
import uuid
from datetime import date, datetime
from pathlib import Path

from app.config import get_settings
from app.services.posthog import capture as posthog_capture
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, UploadFile, File

from app.services import storage
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.application import MembershipApplication
from app.models.settings import AppSettings
from app.schemas.application import (
    ApplicationCreate,
    ApplicationSubmitResponse,
    FeeCalculationResponse,
)
from app.services.fees import calculate_fee, determine_mitgliedschaft_typ, calculate_age
from app.services.pdf import generate_pdf
from app.services.email import send_application_email, send_upload_notification
from app.services.crypto import encrypt_iban, decrypt_iban_safe
from app.services.urls import build_public_url, public_host_display

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["public"])


def _hours_since(ts: datetime | None) -> float | None:
    if not ts:
        return None
    return round((datetime.utcnow() - ts).total_seconds() / 3600, 3)


def _days_since(ts: datetime | None) -> int | None:
    if not ts:
        return None
    return max((datetime.utcnow() - ts).days, 0)


def _format_iban(iban: str) -> str:
    """Format IBAN with spaces every 4 characters."""
    cleaned = iban.replace(" ", "")
    return " ".join(cleaned[i : i + 4] for i in range(0, len(cleaned), 4))


def _compute_anrede(app: MembershipApplication) -> str:
    """Compute a formal salutation string for the contact person of an application."""
    antragstyp = app.antragstyp or "einzel"
    geschlecht = app.geschlecht or ""
    if geschlecht == "Herr":
        prefix = "Sehr geehrter Herr"
    elif geschlecht == "Frau":
        prefix = "Sehr geehrte Frau"
    else:
        # Keine Angabe / divers: address with full name, no gendered title
        if antragstyp == "kind":
            first = app.erziehungsberechtigter_vorname or app.vorname
            last = app.erziehungsberechtigter_nachname or app.nachname
        else:
            first = app.vorname
            last = app.nachname
        return f"Guten Tag {first} {last}"
    last_name = (
        app.erziehungsberechtigter_nachname or app.nachname
        if antragstyp == "kind"
        else app.nachname
    )
    return f"{prefix} {last_name}"


def _build_application_data(app: MembershipApplication) -> dict:
    """Build template data dict from application model."""
    fee_amount, fee_label = calculate_fee(
        app.mitgliedschaft_typ, app.elternteil_mitglied
    )

    antragstyp = app.antragstyp or "einzel"

    data = {
        "id": app.id,
        "antragsnummer": app.antragsnummer or "",
        "antragstyp": antragstyp,
        "geschlecht": app.geschlecht or "",
        "anrede": _compute_anrede(app),
        "mandatsreferenz": app.mandatsreferenz or "",
        "glaeubiger_id": "DE71ZZZ00000901082",
        "upload_token": app.upload_token or "",
        "upload_url": build_public_url(f"/upload/{app.upload_token}") if app.upload_token else "",
        "status_url": build_public_url(f"/status?nr={app.antragsnummer}") if app.antragsnummer else "",
        "logo_url": build_public_url("/logo_svu-241x300.png"),
        "site_host_display": public_host_display(),
        "vorname": app.vorname,
        "nachname": app.nachname,
        "geburtsdatum": app.geburtsdatum,
        "geburtsdatum_formatted": app.geburtsdatum.strftime("%d.%m.%Y"),
        "strasse": app.strasse,
        "plz": app.plz,
        "ort": app.ort,
        "telefon": app.telefon,
        "email": app.email,
        "abteilungen": app.get_abteilungen(),
        "abteilungen_display": ", ".join(app.get_abteilungen()),
        "mitgliedschaft_typ": app.mitgliedschaft_typ,
        "elternteil_mitglied": app.elternteil_mitglied,
        "jahresbeitrag": int(app.jahresbeitrag),
        "fee_label": fee_label,
        "kontoinhaber": app.kontoinhaber,
        "iban": decrypt_iban_safe(app.iban),
        "iban_formatted": _format_iban(decrypt_iban_safe(app.iban)),
        "bic": app.bic,
        "kreditinstitut": app.kreditinstitut,
        "datum": date.today().strftime("%d.%m.%Y"),
        "consent_at": app.consent_at,
        "consent_at_formatted": app.consent_at.strftime("%d.%m.%Y um %H:%M Uhr") if app.consent_at else None,
        "datenschutz_accepted": app.datenschutz_accepted,
        "satzung_accepted": app.satzung_accepted,
    }

    # Guardian info for Kind type
    if antragstyp == "kind":
        data["erziehungsberechtigter_vorname"] = app.erziehungsberechtigter_vorname or ""
        data["erziehungsberechtigter_nachname"] = app.erziehungsberechtigter_nachname or ""
        data["erziehungsberechtigter_name"] = (
            f"{app.erziehungsberechtigter_nachname or ''}, {app.erziehungsberechtigter_vorname or ''}"
        )

    # Children for Familie type
    if antragstyp == "familie":
        kinder = app.get_kinder()
        for k in kinder:
            if isinstance(k.get("geburtsdatum"), str):
                try:
                    dob = date.fromisoformat(k["geburtsdatum"])
                    k["geburtsdatum_formatted"] = dob.strftime("%d.%m.%Y")
                    k["age"] = calculate_age(dob)
                except (ValueError, TypeError):
                    k["geburtsdatum_formatted"] = k["geburtsdatum"]
                    k["age"] = None
            k["abteilungen_display"] = ", ".join(k.get("abteilungen", []))
        data["kinder"] = kinder

        # Partner / second parent
        if app.partner_vorname and app.partner_nachname:
            data["partner_vorname"] = app.partner_vorname
            data["partner_nachname"] = app.partner_nachname
            data["partner_name"] = f"{app.partner_nachname}, {app.partner_vorname}"
            if app.partner_geburtsdatum:
                data["partner_geburtsdatum"] = app.partner_geburtsdatum
                data["partner_geburtsdatum_formatted"] = app.partner_geburtsdatum.strftime("%d.%m.%Y")
            data["partner_abteilungen"] = app.get_partner_abteilungen()
            data["partner_abteilungen_display"] = ", ".join(app.get_partner_abteilungen())

    return data


async def _send_email_task(application_id: int, db_url: str, unterschrift_base64: str | None = None):
    """Background task to generate PDF and send email."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    _kwargs = {"connect_args": {"check_same_thread": False}} if db_url.startswith("sqlite") else {}
    eng = create_engine(db_url, **_kwargs)
    SessionLocal = sessionmaker(bind=eng)
    db = SessionLocal()

    try:
        app = db.query(MembershipApplication).filter(
            MembershipApplication.id == application_id
        ).first()
        if not app:
            logger.error(f"Application {application_id} not found for email")
            return

        settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
        if not settings or not settings.smtp_host:
            logger.warning("SMTP not configured, skipping email")
            return

        data = _build_application_data(app)

        # Detect online-signed: either the caller passes the raw base64 (fresh submission),
        # or the stored filename ends with "_signed.pdf" (resend after the fact).
        is_online_signed = bool(unterschrift_base64) or bool(
            app.uploaded_file and app.uploaded_file.endswith("_signed.pdf")
        )
        data["signed_online"] = is_online_signed

        if unterschrift_base64:
            # Fresh submission: embed the signature and regenerate the PDF.
            data["unterschrift_base64"] = unterschrift_base64
            pdf_bytes = generate_pdf(data)
        elif is_online_signed and app.uploaded_file:
            # Resend: reuse the stored signed PDF so the attachment still carries the signature.
            pdf_bytes = storage.download_file(app.uploaded_file) or generate_pdf(data)
        else:
            pdf_bytes = generate_pdf(data)

        from app.routers.admin import _log_email

        club_subject = (
            f"Neue Beitrittserklärung: {app.nachname}, {app.vorname}"
        )
        applicant_subject = "Ihre Beitrittserklärung – Sportverein 1945 Untereuerheim e.V."
        send_error: Exception | None = None
        success = False
        try:
            success = await send_application_email(
                smtp_host=settings.smtp_host,
                smtp_port=settings.smtp_port,
                smtp_user=settings.smtp_user,
                smtp_password=settings.smtp_password,
                smtp_from=settings.smtp_from,
                smtp_use_tls=settings.smtp_use_tls,
                notification_email=settings.notification_email,
                applicant_email=app.email,
                application_data=data,
                pdf_bytes=pdf_bytes,
            )
        except Exception as e:
            send_error = e
            success = False

        _log_email(db, "application_club", settings.notification_email,
                   club_subject, success, send_error,
                   app.antragsnummer, app.vorname, app.nachname)
        _log_email(db, "application_applicant", app.email,
                   applicant_subject, success, send_error,
                   app.antragsnummer, app.vorname, app.nachname)

        if success:
            app.email_sent = True
            db.commit()
    except Exception as e:
        logger.error(f"Email task error: {e}")
    finally:
        db.close()
        eng.dispose()


@router.post("/apply", response_model=ApplicationSubmitResponse)
async def submit_application(
    data: ApplicationCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Submit a new membership application."""
    # Calculate fee
    fee_amount, fee_label = calculate_fee(
        data.mitgliedschaft_typ, data.elternteil_mitglied
    )

    # Create application
    application = MembershipApplication(
        antragstyp=data.antragstyp,
        geschlecht=data.geschlecht,
        vorname=data.vorname,
        nachname=data.nachname,
        geburtsdatum=data.geburtsdatum,
        strasse=data.strasse,
        plz=data.plz,
        ort=data.ort,
        telefon=data.telefon,
        email=data.email,
        erziehungsberechtigter_vorname=data.erziehungsberechtigter_vorname,
        erziehungsberechtigter_nachname=data.erziehungsberechtigter_nachname,
        partner_vorname=data.partner_vorname,
        partner_nachname=data.partner_nachname,
        partner_geburtsdatum=data.partner_geburtsdatum,
        partner_abteilungen=json.dumps(data.partner_abteilungen) if data.partner_abteilungen else None,
        kinder=json.dumps([k.model_dump(mode="json") for k in data.kinder]) if data.kinder else None,
        abteilungen=json.dumps(data.abteilungen),
        mitgliedschaft_typ=data.mitgliedschaft_typ,
        elternteil_mitglied=data.elternteil_mitglied,
        jahresbeitrag=fee_amount,
        kontoinhaber=data.kontoinhaber,
        iban=encrypt_iban(data.iban),
        bic=data.bic,
        kreditinstitut=data.kreditinstitut,
        consent_at=datetime.utcnow(),
        datenschutz_accepted=data.datenschutz_accepted,
        satzung_accepted=data.satzung_accepted,
        consent_ip=request.client.host if request.client else None,
    )

    db.add(application)
    db.flush()  # get the id

    # Generate Antragsnummer: ANT-YYYY-XXXXXX (random, non-sequential)
    import secrets
    import string
    year = date.today().year
    _charset = string.ascii_uppercase + string.digits
    _charset = _charset.replace("O", "").replace("I", "").replace("L", "").replace("0", "")  # remove ambiguous
    for _attempt in range(20):
        rand_part = "".join(secrets.choice(_charset) for _ in range(6))
        candidate = f"ANT-{year}-{rand_part}"
        exists = db.query(MembershipApplication.id).filter(
            MembershipApplication.antragsnummer == candidate
        ).first()
        if not exists:
            application.antragsnummer = candidate
            break
    else:
        # Fallback: use uuid hex
        application.antragsnummer = f"ANT-{year}-{uuid.uuid4().hex[:8].upper()}"

    # Generate upload token
    application.upload_token = str(uuid.uuid4())

    # Generate Mandatsreferenz using the DB row id to avoid concurrency races.
    year = date.today().year
    application.mandatsreferenz = f"SVU1945-{year}-{application.id:05d}"

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Antrag konnte wegen einer Kollision nicht gespeichert werden. Bitte erneut versuchen.",
        )
    db.refresh(application)

    # Option B: inline signature provided → generate signed PDF, store it,
    # and advance status to "dokument_hochgeladen" immediately.
    if data.unterschrift_base64:
        try:
            app_data = _build_application_data(application)
            app_data["unterschrift_base64"] = data.unterschrift_base64
            pdf_bytes = generate_pdf(app_data)

            signed_filename = f"{application.antragsnummer}_signed.pdf"
            storage.upload_file(signed_filename, pdf_bytes, content_type="application/pdf")

            application.uploaded_file = signed_filename
            application.uploaded_at = datetime.utcnow()
            application.status = "dokument_hochgeladen"
            try:
                db.commit()
            except Exception:
                db.rollback()
                storage.delete_file(signed_filename)
                raise
            db.refresh(application)
            logger.info(f"Inline-signed PDF saved for {application.antragsnummer}")
        except Exception as exc:
            logger.error(f"Failed to generate inline-signed PDF: {exc}")
            # Non-fatal: continue without embedding; status stays "neu"

    # Track membership application submission
    posthog_capture(
        "membership_application_submitted",
        application.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": application.id,
            "antragsnummer": application.antragsnummer,
            "antragstyp": application.antragstyp or "einzel",
            "mitgliedschaft_typ": application.mitgliedschaft_typ,
            "jahresbeitrag": float(application.jahresbeitrag),
            "abteilungen_count": len(application.get_abteilungen()),
            "online_signed": bool(data.unterschrift_base64),
            "signature_mode": "inline" if data.unterschrift_base64 else "paper_upload",
            "status_after_submit": application.status,
            "hours_to_submit": 0,
        },
    )

    # Send email in background (signature forwarded so PDF in email also carries it)
    from app.config import get_settings
    settings = get_settings()
    background_tasks.add_task(
        _send_email_task,
        application.id,
        settings.database_url,
        data.unterschrift_base64,
    )

    return ApplicationSubmitResponse(
        id=application.id,
        antragsnummer=application.antragsnummer,
        mandatsreferenz=application.mandatsreferenz,
        upload_url=build_public_url(f"/upload/{application.upload_token}"),
        message="Ihre Beitrittserklärung wurde erfolgreich eingereicht.",
    )


@router.get("/fees/calculate", response_model=FeeCalculationResponse)
async def calculate_membership_fee(
    geburtsdatum: date,
    mitgliedschaft_typ: str,
    elternteil_mitglied: bool | None = None,
):
    """Calculate the annual membership fee."""
    try:
        fee_amount, fee_label = calculate_fee(mitgliedschaft_typ, elternteil_mitglied)
        return FeeCalculationResponse(
            jahresbeitrag=fee_amount,
            mitgliedschaft_typ=mitgliedschaft_typ,
            label=fee_label,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/iban/lookup")
async def lookup_iban(iban: str):
    """Validate IBAN and look up BIC + bank name."""
    cleaned = iban.replace(" ", "").upper()
    result = {"valid": False, "iban": cleaned, "bic": None, "bank_name": None}
    try:
        from schwifty import IBAN as SchwiftyIBAN
        iban_obj = SchwiftyIBAN(cleaned)
        result["valid"] = True
        result["country"] = iban_obj.country_code
        try:
            bic_obj = iban_obj.bic
            result["bic"] = bic_obj.compact
            try:
                names = bic_obj.bank_names
                if isinstance(names, list) and names:
                    result["bank_name"] = names[0]
                elif isinstance(names, dict) and names:
                    result["bank_name"] = list(names.values())[0]
                elif names:
                    result["bank_name"] = str(names)
            except Exception:
                pass
        except Exception:
            pass
    except Exception:
        pass
    return result


@router.get("/health")
async def health_check():
    return {"status": "ok"}


@router.get("/client-config")
async def client_config():
    settings = get_settings()
    enabled = bool(settings.posthog_key)
    return {
        "posthog_enabled": enabled,
        "posthog_key": settings.posthog_key if enabled else None,
        "posthog_host": settings.posthog_host if enabled else None,
    }


@router.get("/check-duplicate")
async def check_duplicate(
    vorname: str,
    nachname: str,
    geburtsdatum: date,
    db: Session = Depends(get_db),
):
    """Check if an application with the same name and DOB already exists."""
    existing = (
        db.query(MembershipApplication.id)
        .filter(
            func.lower(MembershipApplication.vorname) == vorname.strip().lower(),
            func.lower(MembershipApplication.nachname) == nachname.strip().lower(),
            MembershipApplication.geburtsdatum == geburtsdatum,
        )
        .first()
    )
    if existing:
        return {"duplicate": True}
    return {"duplicate": False}


# --- Upload signed document ---

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


@router.get("/upload/{token}")
async def get_upload_info(token: str, db: Session = Depends(get_db)):
    """Get application info for an upload token (used by the upload page)."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.upload_token == token
    ).first()
    if not app:
        posthog_capture(
            "membership_upload_link_invalid",
            "public",
            properties={"app_area": "public", "source": "backend", "reason": "not_found"},
        )
        raise HTTPException(status_code=404, detail="Ungültiger Upload-Link")

    # Check 30-day expiry
    if app.created_at:
        days_since = (datetime.utcnow() - app.created_at).days
        if days_since > 30:
            posthog_capture(
                "membership_upload_link_expired",
                app.antragsnummer or "public",
                properties={
                    "app_area": "public",
                    "source": "backend",
                    "application_id": app.id,
                    "antragsnummer": app.antragsnummer,
                    "days_since_submission": days_since,
                    "reason": "expired_link",
                },
            )
            raise HTTPException(
                status_code=410,
                detail="Der Upload-Link ist abgelaufen (30 Tage). Bitte kontaktieren Sie den Verein."
            )

    return {
        "antragsnummer": app.antragsnummer,
        "vorname": app.vorname,
        "nachname": app.nachname,
        "antragstyp": app.antragstyp,
        "already_uploaded": app.uploaded_file is not None,
        "uploaded_at": app.uploaded_at.isoformat() if app.uploaded_at else None,
    }


@router.post("/upload/{token}")
async def upload_signed_document(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a signed membership application document."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.upload_token == token
    ).first()
    if not app:
        posthog_capture(
            "membership_upload_link_invalid",
            "public",
            properties={"app_area": "public", "source": "backend", "reason": "not_found"},
        )
        raise HTTPException(status_code=404, detail="Ungültiger Upload-Link")

    # Check 30-day expiry
    if app.created_at:
        days_since = (datetime.utcnow() - app.created_at).days
        if days_since > 30:
            posthog_capture(
                "membership_upload_link_expired",
                app.antragsnummer or "public",
                properties={
                    "app_area": "public",
                    "source": "backend",
                    "application_id": app.id,
                    "antragsnummer": app.antragsnummer,
                    "days_since_submission": days_since,
                    "reason": "expired_link",
                },
            )
            raise HTTPException(
                status_code=410,
                detail="Der Upload-Link ist abgelaufen (30 Tage). Bitte kontaktieren Sie den Verein."
            )

    # Validate file extension
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Nicht erlaubtes Dateiformat. Erlaubt: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read and validate size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Datei zu groß (max. 20 MB)")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")

    # Save file to Tigris
    filename = f"{app.antragsnummer}_{uuid.uuid4().hex[:8]}{ext}"
    content_type = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".heic": "image/heic", ".heif": "image/heif",
    }.get(ext, "application/octet-stream")
    storage.upload_file(filename, contents, content_type=content_type)

    # Update application
    old_filename = app.uploaded_file

    app.uploaded_file = filename
    app.uploaded_at = datetime.utcnow()
    # Auto-advance status
    if app.status == "neu":
        app.status = "dokument_hochgeladen"
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_file(filename)
        raise

    # Delete previous upload only after new DB state has been committed.
    if old_filename:
        storage.delete_file(old_filename)

    logger.info(f"Upload received for {app.antragsnummer}: {filename} ({len(contents)} bytes)")

    # Track document upload
    posthog_capture(
        "membership_document_uploaded",
        app.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "status_after_upload": app.status,
            "file_extension": ext,
            "file_size_bytes": len(contents),
        },
    )

    # Send notifications
    try:
        settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
        if settings and settings.smtp_host:
            import asyncio
            from app.config import get_settings as _get_cfg_upload
            from app.routers.admin import _log_email as _log

            _u_db_url = _get_cfg_upload().database_url
            _u_smtp = settings
            _u_antragsnummer = app.antragsnummer
            _u_vorname = app.vorname
            _u_nachname = app.nachname
            _u_filename = filename
            _u_notification_email = settings.notification_email
            _u_applicant_email = app.email
            _u_anrede = _compute_anrede(app)

            async def _notify_admin_and_log():
                from sqlalchemy.orm import sessionmaker as _sm2
                from app.routers.admin import _make_engine
                _eng2 = _make_engine(_u_db_url)
                _ldb2 = _sm2(bind=_eng2)()
                _subject2 = f"Dokument hochgeladen: {_u_antragsnummer}"
                _ok2, _err2 = False, None
                try:
                    await send_upload_notification(
                        smtp_host=_u_smtp.smtp_host,
                        smtp_port=_u_smtp.smtp_port,
                        smtp_user=_u_smtp.smtp_user,
                        smtp_password=_u_smtp.smtp_password,
                        smtp_from=_u_smtp.smtp_from,
                        smtp_use_tls=_u_smtp.smtp_use_tls,
                        notification_email=_u_notification_email,
                        antragsnummer=_u_antragsnummer,
                        vorname=_u_vorname,
                        nachname=_u_nachname,
                        filename=_u_filename,
                    )
                    _ok2 = True
                except Exception as _e2:
                    _err2 = _e2
                finally:
                    _log(_ldb2, "upload_notification", _u_notification_email, _subject2,
                         _ok2, _err2, _u_antragsnummer, _u_vorname, _u_nachname)
                    _ldb2.close()
                    _eng2.dispose()

            async def _confirm_upload_and_log():
                from sqlalchemy.orm import sessionmaker as _sm3
                from app.services.email import send_status_email as _sse
                from app.routers.admin import _make_engine
                _eng3 = _make_engine(_u_db_url)
                _ldb3 = _sm3(bind=_eng3)()
                _subject3 = "Ihr Dokument wurde empfangen"
                _ok3, _err3 = False, None
                try:
                    await _sse(
                        smtp_host=_u_smtp.smtp_host,
                        smtp_port=_u_smtp.smtp_port,
                        smtp_user=_u_smtp.smtp_user,
                        smtp_password=_u_smtp.smtp_password,
                        smtp_from=_u_smtp.smtp_from,
                        smtp_use_tls=_u_smtp.smtp_use_tls,
                        applicant_email=_u_applicant_email,
                        vorname=_u_vorname,
                        nachname=_u_nachname,
                        antragsnummer=_u_antragsnummer,
                        status="dokument_hochgeladen",
                        anrede=_u_anrede,
                    )
                    _ok3 = True
                except Exception as _e3:
                    _err3 = _e3
                finally:
                    _log(_ldb3, "upload_notification", _u_applicant_email, _subject3,
                         _ok3, _err3, _u_antragsnummer, _u_vorname, _u_nachname)
                    _ldb3.close()
                    _eng3.dispose()

            asyncio.ensure_future(_notify_admin_and_log())
            asyncio.ensure_future(_confirm_upload_and_log())
    except Exception as e:
        logger.error(f"Failed to send upload notification: {e}")

    return {
        "message": "Dokument erfolgreich hochgeladen",
        "filename": filename,
        "antragsnummer": app.antragsnummer,
    }


# --- Status lookup ---

STATUS_LABELS = {
    "neu": "Eingegangen",
    "dokument_hochgeladen": "Dokument hochgeladen",
    "in_bearbeitung": "In Bearbeitung",
    "genehmigt": "Genehmigt",
    "abgelehnt": "Abgelehnt",
}

STATUS_ORDER = ["neu", "dokument_hochgeladen", "in_bearbeitung", "genehmigt"]


@router.get("/status/{antragsnummer}")
async def lookup_status(antragsnummer: str, db: Session = Depends(get_db)):
    """Public status lookup by Antragsnummer."""
    app = db.query(MembershipApplication).filter(
        MembershipApplication.antragsnummer == antragsnummer.strip().upper()
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Antragsnummer nicht gefunden")

    posthog_capture(
        "membership_status_lookup",
        app.antragsnummer,
        properties={
            "app_area": "public",
            "source": "backend",
            "application_id": app.id,
            "antragsnummer": app.antragsnummer,
            "status": app.status,
            "has_upload": app.uploaded_file is not None,
            "days_since_submission": _days_since(app.created_at),
        },
    )

    result = {
        "antragsnummer": app.antragsnummer,
        "status": app.status,
        "status_label": STATUS_LABELS.get(app.status, app.status),
        "created_at": app.created_at.isoformat() if app.created_at else None,
        "uploaded_at": app.uploaded_at.isoformat() if app.uploaded_at else None,
        "has_upload": app.uploaded_file is not None,
    }
    if app.status == "abgelehnt" and app.admin_decline_reason:
        result["admin_decline_reason"] = app.admin_decline_reason
    return result
